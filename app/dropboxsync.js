const crypto = require('crypto')
const fetch = require('isomorphic-fetch')
const Dropbox = require('dropbox').Dropbox
const path = require('path')
const shell = require('shelljs')
const fs = require('fs')
const { promisify } = require('util')

// Config

if (!process.env.DROPBOX_ACCESS_TOKEN) {
  console.error('No DROPBOX_ACCESS_TOKEN environment variable specified')
  process.exit()
}
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN
const DROPBOX_APP_ID = process.env.DROPBOX_APP_ID
if (!process.env.DROPBOX_SECRET) {
  console.error('No DROPBOX_SECRET environment variable specified')
  process.exit()
}
const DROPBOX_SECRET = process.env.DROPBOX_SECRET

let DROPBOX_REMOTE_FOLDER_PATH = process.env.DROPBOX_REMOTE_FOLDER_PATH || '/www'
if (DROPBOX_REMOTE_FOLDER_PATH[DROPBOX_REMOTE_FOLDER_PATH.length - 1] !== '/') {
  DROPBOX_REMOTE_FOLDER_PATH = DROPBOX_REMOTE_FOLDER_PATH + '/'
}
if (DROPBOX_REMOTE_FOLDER_PATH[0] !== '/') {
  DROPBOX_REMOTE_FOLDER_PATH = '/' + DROPBOX_REMOTE_FOLDER_PATH
}
const DROPBOX_LOCAL_FOLDER_PATH = process.env.DROPBOX_LOCAL_FOLDER_PATH || '/tmp/public'
const STATE_PATH = process.env.STATE_PATH || '/tmp/state'
shell.mkdir('-p', DROPBOX_LOCAL_FOLDER_PATH)
shell.mkdir('-p', STATE_PATH)

// Globals

const dbx = new Dropbox({ accessToken: DROPBOX_ACCESS_TOKEN, fetch })
const writeFileAsync = promisify(fs.writeFile)
const readFileAsync = promisify(fs.readFile)

// Webhook

const setupDropboxWebhook = (app) => {
  // You can verify the authenticity of the request by looking at the X-Dropbox-Signature header, which will contain the HMAC-SHA256 signature of the entire request body using your app secret as the key.
  // MUST come before body-parser so we can check the signature
  // https://stackoverflow.com/questions/9920208/expressjs-raw-body
  app.use(function (req, res, next) {
    var data = ''
    req.setEncoding('utf8')
    req.on('data', function (chunk) {
      data += chunk
    })
    req.on('end', function () {
      req.rawBody = data
      next()
    })
  })
  app.all('/webhook', async (req, res, next) => {
    if (req.method === 'GET' && req.query.hasOwnProperty('challenge')) {
      console.log(req.query['challenge'])
      res.append('Content-Type', 'text/plain')
      res.append('X-Content-Type-Options', 'nosniff')
      res.send(req.query['challenge'])
    } else {
      const hmac = crypto.createHmac('SHA256', DROPBOX_SECRET)
      hmac.update(req.rawBody)
      const hash = hmac.digest('hex')
      if (req.get('X-Dropbox-Signature') === hash) {
        const hook = JSON.parse(req.rawBody)
        console.log(hook)
        if (DROPBOX_APP_ID && hook.list_folder.accounts[0] !== DROPBOX_APP_ID) {
          console.error('Unknown App ID')
          res.status(500)
          res.send('Unknown App ID')
        } else {
          await statefullSync()
          res.send('OK')
        }
      } else {
        console.error('Invalid Signature')
        res.status(500)
        res.send('Invalid Signature')
      }
    }
  })
}

const syncOne = async (remotePath) => {
  const localPath = path.join(DROPBOX_LOCAL_FOLDER_PATH, remotePath.slice(DROPBOX_REMOTE_FOLDER_PATH.length, remotePath.length))
  const parts = localPath.split('/')
  const filename = parts[parts.length - 1]
  const dir = parts.slice(0, parts.length - 1).join('/')
  shell.mkdir('-p', dir)
  const dest = path.join(dir, filename)
  let fileDownload
  try {
    fileDownload = await dbx.filesDownload({ path: remotePath })
    await writeFileAsync(dest, fileDownload.fileBinary, { encoding: 'utf8' })
  } catch (e) {
    if (e.response.statusText.substring(0, 14) === 'path/not_found') {
      console.error('Not found')
    } else {
      console.error('Could not get file', e)
    }
    return false
  }
  console.log(`Saved to ${dest}`)
  return true
}

const getChanges = async (cursor) => {
  const res = await fetch(
    'https://api.dropboxapi.com/2/files/list_folder/continue',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ cursor })
    }
  )
  let result = {}
  console.log(res.status)
  if (res.status !== 200) {
    throw new Error(await res.text())
  }
  const json = await res.json()
  // console.log('JSON', json)
  for (let i = 0; i < json.entries.length; i++) {
    const { content_hash, id } = json.entries[i]
    const contentHash = content_hash
    if (json.entries[i]['.tag'] === 'file') {
      if (json.entries[i].path_display.startsWith(DROPBOX_REMOTE_FOLDER_PATH)) {
        result[json.entries[i].path_display] = { contentHash, id }
        // console.log(json.entries[i].path_display)
      } else {
        console.log('Skipping', json.entries[i].path_display)
      }
    }
  }
  console.log(result)
  cursor = json.cursor
  console.log('Result', result)
  if (json.has_more) {
    const next = await getChanges(cursor)
    result = Object.assign(result, next.changes)
    cursor = next.cursor
  }
  return { 'changes': result, 'cursor': cursor }
}

const getCursor = async () => {
  // Load from the filename
  try {
    const data = await readFileAsync(path.join(STATE_PATH, 'cursor.json'), { encoding: 'utf8' })
    const cursor = JSON.parse(data)
    return cursor
  } catch (e) {
    // Otherwise get a new cursor from the list_folder call with the correct path
    const body = JSON.stringify({ 'path': DROPBOX_REMOTE_FOLDER_PATH, 'recursive': true })
    const res = await fetch(
      'https://api.dropboxapi.com/2/files/list_folder',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body
      }
    )
    console.log(res.status)
    if (res.status !== 200) {
      throw new Error(await res.text())
    }
    const json = await res.json()
    // console.log(json)
    return json.cursor
  }
}

const setCursor = async (cursor) => {
  console.log('Writing cursor', cursor)
  await writeFileAsync(path.join(STATE_PATH, 'cursor.json'), JSON.stringify(cursor), { encoding: 'utf8' })
}

const syncDropbox = async (startCursor) => {
  const { changes, cursor } = await getChanges(startCursor)
  console.log('==== Got new cursor', cursor)
  console.log(changes)
  const promises = []
  for (var changedPath in changes) {
    if (changes.hasOwnProperty(changedPath)) {
      promises.push((async function (changedPath) {
        const success = await syncOne(changedPath)
        if (success) {
          console.log(`Synced ${changedPath}`)
          return success
        } else {
          console.log(`Failed to sync ${changedPath}`)
          return false
        }
      }(changedPath)))
    }
  }
  console.log('Returning new cursor', cursor)
  return { 'cursor': cursor, 'downloads': promises }
}

const dropboxStatefulSync = async () => {
  const startCursor = await getCursor()
  console.log('Got cursor', startCursor)
  // We assume that the call above only sends the folder itself
  const { cursor, downloads } = await syncDropbox(startCursor)
  console.log(cursor, downloads)
  await Promise.all(downloads)
  console.log('Saving cursor to disk', cursor)
  await setCursor(cursor)
}

module.exports = {
  setupDropboxWebhook,
  dropboxStatefulSync,
  DROPBOX_ACCESS_TOKEN,
  DROPBOX_APP_ID,
  DROPBOX_SECRET,
  DROPBOX_REMOTE_FOLDER_PATH,
  DROPBOX_LOCAL_FOLDER_PATH,
  STATE_PATH
}
