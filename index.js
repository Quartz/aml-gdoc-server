#!/usr/bin/env node

var inquirer = require('inquirer');
var exec = require('child_process').exec;
var expandTilde = require('expand-tilde');
var express = require('express');
var url = require('url');
var archieml = require('archieml');
var google = require("googleapis");
var fs = require("fs");
var OAuth2 = google.auth.OAuth2;
var htmlparser = require('htmlparser2');
var Entities = require('html-entities').AllHtmlEntities;

var questions = [];

var config;
var configpath = expandTilde("~/.aml-gdoc-credentials");

var HOST = "http://127.0.0.1";
var PORT = 6006;
var BASE_URL = HOST + ":" + PORT;
var REDIRECT_PATH = "/auth";
var LOGIN_PATH = "/login";
var REDIRECT_URL = BASE_URL + REDIRECT_PATH;

var oauth2Client;
var drive;
var app = express();

var TOKEN;
var DOC_KEY;

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
	console.log(" 2. Create a new project. (It dosen't matter what you name it.)");
	console.log(" 3. Wait for the project to be created, then click")
	console.log("   \"Enable and manage APIS\" on the page it brings you to.");
	console.log(" 4. Click \"Drive API\" under Google Apps and APIs." );
	console.log(" 5. Click \"Enable API.\"");
	console.log(" 6. In the menu on the left, click \"Credentials.\"");
	console.log(" 7. Click \"Add Credentials\" select \"OAuth 2.0 client ID credentials\"");
	console.log("    (it might ask you to fill out the OAuth consent screen; do that.)");
	console.log(" 8. Select \"Web Application\" from the list and click the create button.");
	console.log(" 9. Set an authorized JavaScript origin of: " + BASE_URL)
	console.log("10. Set an authorized redirect URI of " + REDIRECT_URL);
	console.log("11. Click create.\n\n");

	questions.push({
		type:"confirm",
		name:"got-credentials",
		message:"Have you completed the instructions above?\n",
		default: null
	});

	config = {
		tokens: {},
		credentials: {

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


function parseGDoc(dom) {
	// Parse the document as HTML
	//
	// There are a few extra steps that we do to make working with Google
	// Documents more useful. With a little more prep, we generally process
	// the documents to:
	//
	//   * Include links that users enter in the google document as HTML
	//     `<a>` tags
	//   * Remove smart quotes inside tag brackets `<>` (which Google loves
	//     to add for you)
	//   * Ensure that list bullet points are turned into `*`s
	//
	// Unfortunately, google strips out links when you export as `text/plain`,
	// so if you want to preserve them, we have to export the document in a
	// different format, `text/html`.

	var tagHandlers = {
		_base: function (tag) {
		var str = '';
		tag.children.forEach(function(child) {
			if (func = tagHandlers[child.name || child.type]) str += func(child);
		});
			return str;
		},
		text: function (textTag) {
			return textTag.data;
		},
		span: function (spanTag) {
			return tagHandlers._base(spanTag);
		},
		p: function (pTag) {
			return tagHandlers._base(pTag) + '\n';
		},
		a: function (aTag) {
		var href = aTag.attribs.href;
		if (href === undefined) return '';

		// extract real URLs from Google's tracking
		// from: http://www.google.com/url?q=http%3A%2F%2Fwww.nytimes.com...
		// to: http://www.nytimes.com...
		if (aTag.attribs.href && url.parse(aTag.attribs.href,true).query && url.parse(aTag.attribs.href,true).query.q) {
			href = url.parse(aTag.attribs.href,true).query.q;
		}

		var str = '<a href="' + href + '">';
		str += tagHandlers._base(aTag);
		str += '</a>';
		return str;
		},
		li: function (tag) {
		return '* ' + tagHandlers._base(tag) + '\n';
		}
	};

	['ul', 'ol'].forEach(function(tag) {
		tagHandlers[tag] = tagHandlers.span;
	});
	['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function(tag) {
		tagHandlers[tag] = tagHandlers.p;
	});

	var body = dom[0].children[1];
	var parsedText = tagHandlers._base(body);
	

	// Convert html entities into the characters as they exist in the google doc
	var entities = new Entities();
	parsedText = entities.decode(parsedText);

	// Remove smart quotes from inside tags
	parsedText = parsedText.replace(/<[^<>]*>/g, function(match){
		return match.replace(/”|“/g, '"').replace(/‘|’/g, "'");
	});

	return archieml.load(parsedText);
}

app.get(REDIRECT_PATH, function(req, res) {
	var code = url.parse(req.url, true).query.code;
	oauth2Client.getToken(code,function(err,tokens) {
		if(!err) {
			config.tokens = tokens;
			fs.writeFileSync(configpath,JSON.stringify(config),"utf8");
			oauth2Client.setCredentials(config.tokens);
			console.log("The app is now authorized");
			res.send("The app is now authorized!");
		}
		else {
			res.send("There was an error getting an access token");
		}
	});
});

app.get(LOGIN_PATH, function(req, res) {
	var redirect_url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: ['https://www.googleapis.com/auth/drive.readonly'],
		approval_prompt: 'force'
	});

	res.redirect(redirect_url);
});

app.get("/favicon.ico",function(req,res) {
	res.status(404).send("Not found");
});

app.get('/:key', function (req, res) {
	var latest_tokens = JSON.parse(fs.readFileSync(configpath,"utf8")).tokens;

	oauth2Client.setCredentials(latest_tokens);

	oauth2Client.refreshAccessToken(function(err, tokens) {

		if(!err) {
			config.tokens = tokens;
			fs.writeFileSync(configpath,JSON.stringify(config),"utf8");

			oauth2Client.setCredentials(config.tokens);
			request = drive.files.get({fileId: DOC_KEY}, function (err, doc) {
				if (err) return res.send(err);

				export_link = doc.exportLinks['text/html'];
				oauth2Client._makeRequest({method: "GET", uri: export_link}, function(err, body) {
					var handler = new htmlparser.DomHandler(function(error, dom) {
						var parsed = parseGDoc(dom);
						res.send(parsed);
					});

					var parser = new htmlparser.Parser(handler);

					parser.write(body);
					parser.done();
				});
			});
		}
		else {
			res.send(err);
		}

		
	});
	
});

app.param('key', function (req, res, next, key) {
  DOC_KEY = key || DOC_KEY;
  next();
});

function run() {
	CLIENT_ID = config.credentials.client_id;
	CLIENT_SECRET = config.credentials.client_secret;


	oauth2Client = new OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);
	drive = google.drive({version:'v2', auth: oauth2Client});

	var server = app.listen(PORT, function () {

		if(!config.tokens.access_token) {
			console.log('Please authorize the app in your browser');

			exec("open " + BASE_URL + LOGIN_PATH, function(error,stdout,stderr){
				if (error) console.log(error);
			});
		}
		else {
			console.log("you're all set up and ready to go!");
		}

		console.log('the aml-gdoc-server is up and listening at http://%s:%s', HOST, PORT);
	});

}

if(questions.length) {
	inquirer.prompt(questions, function(answers){
		config.credentials = {
			client_id: config.credentials.id || answers.client_id,
			client_secret: config.credentials.client_secret || answers.client_secret,
		};

		run();
	});
}
else {
	run();
}





