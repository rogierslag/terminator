'use strict';

var express = require('express');
var config = require('config');
var bodyParser = require('body-parser');
var request = require("request");

// Create the server
var app = express();
app.use(bodyParser.json());
app.get('/health', checkHealth);
app.post('/', checkPayload);

// And listen!
var server = app.listen(8543, function () {
    console.log("Terminator is ready to shoot");
});

// Check whether we are running and if yes return ok
function checkHealth(req, res) {
  res.writeHead(200, 'OK');
  res.write('Boom!');
  res.end();
  console.log('Processed successful healthcheck');
  return;
}

// Determine whether to do something with the payload
function checkPayload(req, res) {
  if ( req.body.zen ) {
    // This is a github test payload!
    console.log("Github test payload");
    var validRepo = config.get('repos').indexOf(req.body.repository.full_name.toLowerCase()) > -1;
    if ( validRepo ) {
      res.status(200).write('Well Github, I love you too!');
      res.end();
    } else {
      res.status(403).write('This repository is not configured for Terminator');
      res.end();
    }
    return;
  }

  if ( config.get('repos').indexOf(req.body.pull_request.head.repo.full_name.toLowerCase()) > -1 ) {
    console.log("Received a request for matching repo: " + req.body.pull_request.head.repo.full_name);
    console.log("Action is: " + req.body.action);
    if ( req.body.action === 'opened' || req.body.action === 'synchronize' ) {
      return checkFiles(req, res);
    } else {
      res.writeHead(200, 'OK');
      res.end();
      return;
    }
  } else {
    console.log('Incoming request did not match any repository [' + req.body.pull_request.head.repo.full_name + ']');
    res.writeHead(403, 'Forbidden');
    res.end();
    return;
  }
}

// Determine what we should send back to github
function checkFiles(req, res) {
  var url = 'https://api.github.com/repos/' + req.body.pull_request.head.repo.full_name + '/pulls/' + req.body.pull_request.number + '/files';
  request({
    url: url,
    json: true,
    headers: {
      'User-Agent': 'Terminator https://github.com/rogierslag/terminator',
      'Authorization': 'token ' + config.get('github.oauth_token')
    }
  }, function (error, response, body) {
      if (!error && isValidResponseStatusCode(response.statusCode)) {
        var filesWhichTrigger = body.filter(function(item) { return config.get("files").reduce(function(val,e) { return val || item.filename.endsWith(e); }, false); });
        if ( filesWhichTrigger.length > 0 ) {
          console.log('Did contain files to alert merge');
          reportSuccess(req, res, false);
        } else {
          console.log('Merge is allowed');
          reportSuccess(req, res, true);
        }
      } else {
        console.log('Received an eror from github on url ' + url + ' with body ' + body + ': ' + error + ' (' + response.statusCode + ') with response ' + JSON.stringify(response));
        res.writeHead(500, 'Internal server error');
        res.end();
      }
  });
}

function reportSuccess(req, res, result) {
  var url = 'https://api.github.com/repos/' + req.body.pull_request.head.repo.full_name + '/statuses/' + req.body.pull_request.head.sha;
  var body;

  if ( result ) {
    body = {state: "success", context: "Terminator", description: "This PR does not contain changes which affect deployment"};
  } else {
    body = {state: "pending", context: "Terminator", description: "This PR contains changes which may affect deployment"};
  }

  request.post({
    url: url,
    json: true,
    headers: {
      'User-Agent': 'Terminator https://github.com/rogierslag/terminator',
      'Authorization': 'token ' + config.get('github.oauth_token')
    },
    body: body
  }, function (error, response, body) {
      if (!error && isValidResponseStatusCode(response.statusCode)) {
        res.writeHead(200, 'OK');
        res.end();
      } else {
        console.log('Received an eror from github on url ' + url + ' with body ' + body + ': ' + error + ' (' + response.statusCode + ') with response ' + JSON.stringify(response));
        res.writeHead(500, 'Internal server error');
        res.end();
      }
    });
  }

function isValidResponseStatusCode(code) {
  return code >= 200 && code < 300;
}
