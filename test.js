var request = require('request')
require('request-debug')(request)
require('dotenv').config()

const Deluge = require('./index.js')

var d = new Deluge({
    pass: process.env.DELUGE_PASS,
})

d.login((err) => {
    d.getTorrents((err, res, body) => {
        d.getTorrents((err, res, body) => {
            console.log('Done.')
        })
    })
})
