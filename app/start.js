const express = require('express')
const bodyParser = require('body-parser')
const crypto = require('crypto')
// Polyfill fetch() that dropbox needs
require('isomorphic-fetch') /* global fetch */
const Dropbox = require('dropbox').Dropbox
const ReactDOMServer = require('react-dom/server')
const React = require('react')
const CommonMark = require('commonmark')
const ReactRenderer = require('commonmark-react-renderer')
const mime = require('mime')
const Mustache = require('mustache')
const yamlFront = require('yaml-front-matter')
const { promisify } = require('util')
const path = require('path')
const shell = require('shelljs')
const fs = require('fs')
const writeFileAsync = promisify(fs.writeFile)
const readFileAsync = promisify(fs.readFile)
const existsAsync = promisify(fs.exists)
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
const dbx = new Dropbox({ accessToken: DROPBOX_ACCESS_TOKEN, fetch })
const ce = React.createElement
const app = express()
const parser = new CommonMark.Parser()
const renderer = new ReactRenderer()
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
        const startCursor = await getCursor()
        console.log('Got cursor', startCursor)
        // We assume that the call above only sends the folder itself
        const { cursor, downloads } = await syncDropbox(startCursor)
        console.log(cursor, downloads)
        await Promise.all(downloads)
        console.log('Saving cursor to disk', cursor)
        await setCursor(cursor)
        res.send('OK')
      }
    } else {
      console.error('Invalid Signature')
      res.status(500)
      res.send('Invalid Signature')
    }
  }
})


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

app.use(bodyParser.raw({ type: '*/*' }))

class Hello extends React.Component {
  render () {
    const input = this.props.md
    const ast = parser.parse(input)
    const result = renderer.render(ast)
    return ce('div', {}, [
      ...result
    ])
  }
}

// const fetchFileFromDropbox = async(filename) => {
//   const path = '/' + DROPBOX_REMOTE_FOLDER_PATH + '/public' + filename;
//   // console.log(path)
//   let fileDownload
//   try {
//     fileDownload = await dbx.filesDownload({path})
//   } catch (e) {
//     if (e.response.statusText.substring(0, 14) === 'path/not_found') {
//       return res.status(404).send('Not found')
//     } else {
//       return res.status(500).send('Could not get file')
//     }
//   }
// }

app.get('*', async (req, res, next) => {
  try {
    let filename
    let contentType
    let markdown = false
    if (req.path === '/') {
      filename = '/index.md'
      contentType = 'text/html'
      markdown = true
    } else {
      const parts = req.path.split('/')
      const last = parts[parts.length - 1]
      if (last.includes('.')) {
        const lastParts = last.split('.')
        const ext = lastParts[lastParts.length - 1]
        contentType = mime.getType(ext)
        filename = req.path
      } else {
        filename = req.path + '.md'
        markdown = true
      }
    }
    const localPath = DROPBOX_LOCAL_FOLDER_PATH + '/public' + filename

    if (!await existsAsync(localPath)) {
      res.status(404).send('Not found')
      return
    }

    const fileContent = await readFileAsync(localPath)
    if (markdown) {
      const fileContent = await readFileAsync(localPath, { 'encoding': 'utf8' })
      const { __content: md, title, template } = yamlFront.loadFront(fileContent)
      const elem = React.createElement(Hello, { md }, null)
      const content = ReactDOMServer.renderToString(elem)
      // console.log(title, template)
      const templatePath = DROPBOX_LOCAL_FOLDER_PATH + '/template/' + template + '.mustache'
      const templateContent = await readFileAsync(templatePath, { 'encoding': 'utf8' })
      const output = Mustache.render(templateContent, { title, content })
      res.send(output)
    } else {
      res.contentType(contentType)
      res.end(fileContent)
    }
  } catch (e) {
    next(e)
  }
})

// Leaving these away from production for now
// Use like this when uncommented:
//   curl -X POST -H 'Content-Type: text/plain' --data 'This is a *very* nice sentence.' http://localhost:8004/api/upload
//   curl http://localhost:8004/api/download

// app.get('/api/', (req, res) => {
//   res.contentType('text/plain')
//   res.send('Upload at /upload and download at /download');
// });
//
// app.post('/api/upload', async (req, res, next) => {
//   try {
//     fileUpload = await dbx.filesUpload({ path: PATH, contents: req.body,  mode: 'overwrite'})
//     res.send('done')
//   } catch (e) {
//     next(e)
//   }
// })
//
// app.get('/api/download', async (req, res, next) => {
//   try {
//     const fileDownload = await dbx.filesDownload({path: PATH})
//     const buffer = fileDownload.fileBinary
//     res.send(buffer)
//   } catch (e) {
//     next(e)
//   }
// })

// Error handler has to be last
app.use(function (err, req, res, next) {
  if ((process.env.DEBUG || 'false').toLowerCase() === 'true') {
    console.log('Error:', err)
  }
  res.status(500).send('Something broke!')
})

process.on('SIGINT', function () {
  console.log('Got SIGINT')
  process.exit()
})

const main = async () => {
  const startCursor = await getCursor()
  console.log('Got cursor', startCursor)
  // We assume that the call above only sends the folder itself
  const { cursor, downloads } = await syncDropbox(startCursor)
  console.log(cursor, downloads)
  await Promise.all(downloads)
  console.log('Saving cursor to disk', cursor)
  await setCursor(cursor)
  console.log('Serving on 8004', DROPBOX_REMOTE_FOLDER_PATH, '->', DROPBOX_LOCAL_FOLDER_PATH)
  app.listen(8004)
}

main()
