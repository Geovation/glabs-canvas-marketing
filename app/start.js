const express = require('express');
const bodyParser = require('body-parser');
// Polyfill fetch() that dropbox needs
require('isomorphic-fetch');
const Dropbox = require('dropbox').Dropbox;
const ReactDOMServer = require('react-dom/server')
const React = require('react')
const CommonMark = require('commonmark');
const ReactRenderer = require('commonmark-react-renderer');
const mime = require('mime');
const Mustache = require('mustache');
const yamlFront = require('yaml-front-matter')

if (!process.env.DROPBOX_ACCESS_TOKEN) {
    console.error('No DROPBOX_ACCESS_TOKEN environment variable specified')
    process.exit();
}
const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN })
const ce = React.createElement
const server = express();
const parser = new CommonMark.Parser();
const renderer = new ReactRenderer();
const DROPBOX_FOLDER_PATH = process.env.DROPBOX_FOLDER_PATH || ''
console.log('Serving from', process.env.DROPBOX_FOLDER_PATH)

server.use(bodyParser.raw({type: '*/*'}));

class Hello extends React.Component {
  render() {
    const input = this.props.md
    const ast = parser.parse(input);
    const result = renderer.render(ast);
    return ce('div', {}, [
      // ce('h1', {key: 1}, 'Hello, world'),
      ...result
    ])
  }
}

server.get('*', async (req, res, next) => {
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
      const last = parts[parts.length-1]
      if (last.includes('.')) {
        lastParts = last.split('.')
        ext = lastParts[lastParts.length-1]
        contentType = mime.getType(ext)
        filename = req.path
      } else {
        filename = req.path + '.md'
        markdown = true
      }
    }
    const path = '/' + DROPBOX_FOLDER_PATH + '/public' + filename;
    console.log(path)
    let fileDownload
    try {
      fileDownload = await dbx.filesDownload({path})
    } catch (e) {
      if (e.response.statusText.substring(0, 14) === 'path/not_found') {
        return res.status(404).send('Not found')
      } else {
        return res.status(500).send('Could not get file')
      }
    }
    if (markdown) {
      const fileContent = fileDownload.fileBinary.toString()
      const {__content: md, title, template} = yamlFront.loadFront(fileContent)
      const elem = React.createElement(Hello, {md}, null)
      const content = ReactDOMServer.renderToString(elem);
      // console.log(title, template)
      const templatePath = '/' + DROPBOX_FOLDER_PATH + '/template/' + template + '.mustache'
      let templateDownload
      try {
        templateDownload = await dbx.filesDownload({path: templatePath})
      } catch (e) {
        if (e.response.statusText.substring(0, 14) === 'path/not_found') {
          return res.status(404).send('No such template')
        } else {
          return res.status(500).send('Error getting template')
        }
      }
      const templateContent = templateDownload.fileBinary.toString()
      const output = Mustache.render(templateContent, {title, content})
      res.send(output)
    } else {
      res.contentType(contentType)
      res.end(fileDownload.fileBinary)
    }
  } catch (e) {
    next(e)
  }
});

// Leaving these away from production for now
// Use like this when uncommented:
//   curl -X POST -H 'Content-Type: text/plain' --data 'This is a *very* nice sentence.' http://localhost:8004/api/upload
//   curl http://localhost:8004/api/download

// server.get('/api/', (req, res) => {
//   res.contentType('text/plain')
//   res.send('Upload at /upload and download at /download');
// });
//
// server.post('/api/upload', async (req, res, next) => {
//   try {
//     fileUpload = await dbx.filesUpload({ path: PATH, contents: req.body,  mode: 'overwrite'})
//     res.send('done')
//   } catch (e) {
//     next(e)
//   }
// })
//
// server.get('/api/download', async (req, res, next) => {
//   try {
//     const fileDownload = await dbx.filesDownload({path: PATH})
//     const buffer = fileDownload.fileBinary
//     res.send(buffer)
//   } catch (e) {
//     next(e)
//   }
// })

// Error handler has to be last
server.use(function(err, req, res, next) {
  if ((process.env.DEBUG || 'false').toLowerCase() === 'true') {
    console.log('Error:', err)
  }
  res.status(500).send('Something broke!')
});

process.on('SIGINT', function() {
  console.log('Got SIGINT')
  process.exit();
});

console.log('Serving on 8004')
server.listen(8004);
