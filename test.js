var request = require('request')
require('request-debug')(request)
require('dotenv').config()

const Deluge = require('./index.js')

var d = new Deluge({
    pass: process.env.DELUGE_PASS,
})

d.login((err) => {
    d.connect(0, function(err, res) {
        console.log(err, res)
    })
})
