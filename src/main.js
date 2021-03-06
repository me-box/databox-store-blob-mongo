const https = require('https');
const express = require("express");
const bodyParser = require("body-parser");
const WebSocketServer = require('ws').Server;
const fs = require('fs');
const databox = require('node-databox');


let ARBITER_KEY = '';
let HTTPS_SECRETS = {};
let credentials = {};
try {
	//const ARBITER_KEY = process.env.ARBITER_TOKEN;
	ARBITER_KEY = fs.readFileSync("/run/secrets/ARBITER_TOKEN",{encoding:'base64'});
	//HTTPS certs created by the container mangers for this components HTTPS server.
	credentials = databox.getHttpsCredentials();

} catch (e) {
	//secrets missing ;-(
	ARBITER_KEY = '';
	HTTPS_SECRETS = '';
	credentials = {};
}

const NO_SECURITY = !!process.env.NO_SECURITY;
const NO_LOGGING = !!process.env.NO_LOGGING;

const PORT = process.env.PORT || 8080;


const hypercat = require('./lib/hypercat/hypercat.js');
const macaroonVerifier = require('./lib/macaroon/macaroon-verifier.js');
const SubscriptionManager = require('./lib/subscription/subscriptionManager.js');
const timeseries = require('./timeseries.js');
const keyvalue   = require('./keyvalue.js');

const DATABOX_LOCAL_NAME = process.env.DATABOX_LOCAL_NAME || "store-json";
const DATABOX_LOCAL_PORT = process.env.DATABOX_LOCAL_PORT || 8080;
const DATABOX_ARBITER_ENDPOINT = process.env.DATABOX_ARBITER_ENDPOINT || "https://arbiter:8080";

const app = express();

//Register with arbiter and get secret
macaroonVerifier.getSecretFromArbiter(ARBITER_KEY)
	.then((secret) => {
		app.use(bodyParser.json());
		app.use(bodyParser.urlencoded({extended: true}));

		app.get("/status", (req, res) => res.send("active"));

		var wsVerifier;
		if (!NO_SECURITY) {
			//everything after here will require a valid macaroon
			app.use(macaroonVerifier.verifier(secret, DATABOX_LOCAL_NAME));
			wsVerifier = macaroonVerifier.wsVerifier(secret, DATABOX_LOCAL_NAME);
		}

		var server = null;
		if(credentials.cert === '' || credentials.key === '') {
			var http = require('http');
			console.log("WARNING NO HTTPS credentials supplied running in http mode!!!!");
			server = http.createServer(app);
		} else {
			server = https.createServer(credentials,app);
		}

		app.use('/cat', hypercat(app, DATABOX_LOCAL_NAME, DATABOX_LOCAL_PORT));

		var subscriptionManager = new SubscriptionManager(new WebSocketServer({
			server,
			verifyClient: wsVerifier,
			path: '/ws'
		}));

		app.use('/:datasourceid/ts/:cmd?/:timestamp?/:endtimestamp?', timeseries.api(subscriptionManager));

		app.use('/:key/kv/', keyvalue.api(subscriptionManager));

		app.use('/sub',   subscriptionManager.sub());
		app.use('/unsub', subscriptionManager.unsub());

		server.listen(PORT, function () {
			console.log("Listening on port " + PORT);
		});
	})
	.catch((err) => {
		console.log(err);
	});


module.exports = app;
