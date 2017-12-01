"use strict";

/*
** Import Packages
*/
const restify = require("restify");
const bot_express = require("bot-express");
const server = restify.createServer();

/*
** Middleware Configuration
*/
server.listen(process.env.PORT || 5000, () => {
    console.log("server is running...");
});

/*
** Mount bot-express
*/
server.use("/webhook", bot_express({
    nlp_options: {
        client_access_token: process.env.DIALOGFLOW_CLIENT_ACCESS_TOKEN,
        language: "ja"
    },
    line_channel_secret: process.env.LINE_CHANNEL_SECRET,
    line_channel_access_token: process.env.LINE_ACCESS_TOKEN,
    facebook_app_secret: process.env.FACEBOOK_APP_SECRET,
    facebook_page_access_token: [
        {page_id: process.env.FACEBOOK_PAGE_ID, page_access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN}
    ],
    google_project_id: process.env.GOOGLE_PROJECT_ID,
    auto_translation: process.env.AUTO_TRANSLATION
}));

module.exports = app;
