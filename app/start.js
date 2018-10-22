const express = require('express')
const bodyParser = require('body-parser')
const { DROPBOX_LOCAL_FOLDER_PATH, setupDropboxWebhook, dropboxStatefulSync } = require('./dropboxsync')

const ReactDOMServer = require('react-dom/server')
const React = require('react')
const CommonMark = require('commonmark')
const ReactRenderer = require('commonmark-react-renderer')
const mime = require('mime')
const Mustache = require('mustache')
const yamlFront = require('yaml-front-matter')
const ce = React.createElement
const app = express()
const parser = new CommonMark.Parser()
const renderer = new ReactRenderer()
const { promisify } = require('util')
const fs = require('fs')
const existsAsync = promisify(fs.exists)
const readFileAsync = promisify(fs.readFile)

setupDropboxWebhook(app)
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
  await dropboxStatefulSync()
  console.log('Serving on 8004 from local DropBox path', '->', DROPBOX_LOCAL_FOLDER_PATH)
  app.listen(8004)
}

main()
