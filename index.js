#!/usr/bin/env node

const inquirer = require('inquirer');
const expandTilde = require('expand-tilde');
const express = require('express');
const { google } = require('googleapis');
const { docToArchieML } = require('@newswire/doc-to-archieml');
const fs = require("fs");
const opn = require('opn');
const url = require("url");

var questions = [];

var config;
var configpath = expandTilde("~/.aml-gdoc-credentials");

var HOST = "http://127.0.0.1";
var PORT = 6006;
var BASE_URL = HOST + ":" + PORT;
var REDIRECT_PATH = "/auth";
var LOGIN_PATH = "/login";
var REDIRECT_URL = BASE_URL + REDIRECT_PATH;

var oAuth2Client;
var drive;
var app = express();

var TOKEN;
var DOC_KEY;

const SCOPES = ['https://www.googleapis.com/auth/documents.readonly'];

var hasConfig = false;


try {
	config = JSON.parse(fs.readFileSync(configpath,"utf8"));
	hasConfig = true;
}
catch (e) {
	//no config
	console.log("\x1b[01m")
	console.log("* You have no saved credentials.\n* Let's get you set up.","\x1b[00m")
	console.log(" 1. Go to https://console.developers.google.com");
	console.log(" 2. Click \"Enable APIs and Services\"")
	console.log(" 3. Search for Google Docs API ang click it" );
	console.log(" 4. Click \"Enable\"");
	console.log(" 5. In the menu on the left, click \"Credentials.\"");
	console.log(" 6. Click \"Create Credentials\" select \"OAuth client ID\"");
	console.log(" 7. Select \"Web Application\" from the list and click the create button.");
	console.log(" 8. Set an authorized JavaScript origin of: " + BASE_URL)
	console.log(" 9. Set an authorized redirect URI of " + REDIRECT_URL);
	console.log("10. Click create.\n\n");

	questions.push({
		type:"confirm",
		name:"got-credentials",
		message:"Have you completed the instructions above?\n",
		default: null
	});

	config = {
		tokens: {},
		credentials: {
			redirect_uris: [REDIRECT_URL]
		}
	};
}

if(!config.credentials.client_id) {
	questions.push({
		type:"input",
		name:"client_id",
		message: hasConfig ? "Your Google client id is not set. What is it?\n" : "What is your client id?\n",
		default: null
	});
}

if(!config.credentials.client_secret) {
	questions.push({
		type:"input",
		name:"client_secret",
		message: hasConfig ? "Your Google client secret is not set. What is it?\n" : "What is your client secret?\n",
		default: null
	});
}

function saveConfig() {
	fs.writeFileSync(configpath, JSON.stringify(config, null, 4))
}


function timestamp() {
	return "[" + new Date().toISOString().split("T")[1] + "]";
}

async function updateToken(oA2C) {
	
	console.log(`${timestamp()} Updating access token`);

	oA2C.setCredentials({
		refresh_token: config.tokens.refresh_token
	});

	let t = await oA2C.getAccessToken();
	config.tokens = Object.assign(config.tokens, t.res.data);

	saveConfig();
}

function getNewToken(oA2C, callback) {
  const authUrl = oA2C.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('Please authorize the app in your browser');
  opn(authUrl, {wait: false}).then(cp => cp.unref());

}

function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials;
  oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  	if(!("refresh_token" in config.tokens)) {
  		console.log("HERHER")
  		getNewToken(oAuth2Client);
  	}

	if(Date.now() > config.tokens.expiry_date) updateToken(oAuth2Client)

	oAuth2Client.setCredentials(config.tokens);
	callback(oAuth2Client);
}

app.get(REDIRECT_PATH, function(req, res) {
	console.log(timestamp(), "GET", REDIRECT_PATH);
	var code = url.parse(req.url, true).query.code;


	oAuth2Client.getToken(code, (err, token) => {
	  if (err) return res.send(`There was an error getting an access token\n{JSON.stringify(err, null, 4)}`);

	  oAuth2Client.setCredentials(token);
	  config.tokens = Object.assign(config.tokens, token);
	  saveConfig();

	  console.log(timestamp(), "The app is now authorized");
	  res.send("The app is now authorized!");

	});

});

app.get(LOGIN_PATH, function(req, res) {
	console.log(timestamp(), "GET", LOGIN_PATH);

	var redirect_url = oAuth2Client.generateAuthUrl({
	    access_type: 'offline',
	    scope: SCOPES,
	    approval_prompt:'force'
	});

	res.redirect(redirect_url);
});

app.get("/favicon.ico",function(req,res) {
	res.status(404).send("Not found");
});

app.get('/:key', function (req, res) {
	console.log(timestamp(), "GET", "/" + DOC_KEY);

	if(Date.now() > config.tokens.expiry_date) updateToken(oAuth2Client);

	oAuth2Client.setCredentials(config.tokens);

	docToArchieML({ documentId: DOC_KEY, auth: oAuth2Client })
		.then(r => res.send(r), e => res.status(e.code || 500 ).send(e.response ? e.response.data.error : e))
		.catch(console.log);
	
});

app.param('key', function (req, res, next, key) {
  DOC_KEY = key || DOC_KEY;
  next();
});

function run() {

	var server = app.listen(PORT, function () {
		console.log(`${timestamp()} The aml-gdoc-server is up and listening at ${HOST}:${PORT}`);
	});

	authorize(config.credentials,()=>{})

}

if(questions.length) {
	inquirer.prompt(questions)
		.then(function(answers){
			config.credentials.client_id = config.credentials.id || answers.client_id;
			config.credentials.client_secret = config.credentials.client_secret || answers.client_secret;
		})
		.then(saveConfig)
		.then(run);
}
else {
	run();
}





