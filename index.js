const request = require('request')
const url = require('url')
const fs = require('fs')


function Deluge(option) {
    this.host = (option && option['host']) || "127.0.0.1";
    this.port = (option && option['port']) || 8112;
    this.path = (option && option['path']) || "/";
    this.user = (option && option['user']) || null;
    this.pass = (option && option['pass']) || null;
    this.ssl  = (option && option['ssl'])  || false;
    this.ca   = (option && option['ca'])   || undefined;
    this.timeout = (option && option['timeout']) || 5000;

    this.baseurl = new url.URL(this.host, 'http://' + this.host)
    this.baseurl.port = this.port
    this.baseurl.pathname = this.path

    this.rid = 0 /* used for syncing data */

    this._id = 0

    this.jar = request.jar()

    this.options = {
        timeout: this.timeout,
        ca: this.ca,
        jar: this.jar
    }
}

Deluge.prototype.url = function(path) {
    return url.resolve(this.baseurl.toString(), path)
}

Deluge.prototype._rpc = function(method, params, cb) {
    request(Object.assign({}, this.options, {
        method: 'POST',
        json: true,
        url: this.url('json'),
        gzip: true,
        body: {
            method,
            params,
            id: this._id++,
        }
    }), cb)
}

Deluge.prototype.handleError = function(cb) {
    return function(err, res, body) {
        if (err) {
            /* let the error through */
        } else if (!res || !res.statusCode === 200) {
            err = new Error('Invalid response from deluge API')
        } else if (body && body.error !== null) {
            err = new Error(body.error.message)
        }
        cb(err, body && body.result)
    }
}

Deluge.prototype.login = function(cb) {
    this._rpc('auth.login', [this.pass], function(err, res, body) {
        if (err) {
            /* let the error trough */
        } else if (!res || !res.headers.hasOwnProperty('set-cookie')) {
            err = new Error('Invalid password')
        }
        this.handleError(cb)(...arguments)
    }.bind(this))
}

Deluge.prototype.getHosts = function(cb) {
    this._rpc('web.get_hosts', [], this.handleError(cb))
}

Deluge.prototype._connect = function(hostId, cb) {
    this._rpc('web.connect', [hostId], this.handleError(cb))
}

Deluge.prototype.connect = function(hostId, cb) {
    if (typeof hostId === 'number') {
        this.getHosts(function(err, res) {
            this._connect(res[hostId][0], cb)
        }.bind(this))
    } else {
        this._connect(hostId, cb)
    }
}

Deluge.prototype.getTorrents = function(cb) {
    const fields = [
        'distributed_copies',
        'download_payload_rate',
        'eta',
        'is_auto_managed',
        'max_download_speed',
        'max_upload_speed',
        'name',
        'num_peers',
        'num_seeds',
        'progress',
        'queue',
        'ratio',
        'save_path',
        'seeds_peers_ratio',
        'state',
        'time_added',
        'total_done',
        'total_peers',
        'total_seeds',
        'total_uploaded',
        'total_wanted',
        'tracker_host',
        'upload_payload_rate',
    ]
    this._rpc('web.update_ui', [fields, {}], this.handleError(cb))
}

Deluge.prototype._upload = function(torrent, cb) {
    let r = request(Object.assign({}, this.config, {
        method: 'POST',
        url: this.url('upload'),
        json: true,
        gzip: true,
    }), cb)

    const config = {
        contentType: 'application/x-bittorrent'
    }

    const form = r.form();
    if (typeof torrent === 'string') {
      if (fs.existsSync(torrent)) {
        form.append('file', Buffer.from(fs.readFileSync(torrent)), config);
      } else {
        form.append('file', Buffer.from(torrent, 'base64'), config);
      }
    } else {
      form.append('file', torrent, config);
    }
}

Deluge.prototype._addTorrent = function(path, config, cb) {
    const options = Object.assign({
        file_priorities: [],
        add_paused: false,
        compact_allocation: false,
        max_connections: -1,
        max_download_speed: -1,
        max_upload_slots: -1,
        max_upload_speed: -1,
        prioritize_first_last_pieces: false,
    }, config);
    this._rpc('web.add_torrents', [[{
        path,
        options,
    }]], cb)
}

Deluge.prototype.addTorrent = function(torrent, config, cb) {
    if (!Buffer.isBuffer(torrent)) {
        torrent = Buffer.from(torrent)
    }
    this._upload(torrent, function(err, res, body) {
        if (err) {
            return cb(...arguments)
        }
        const path = body.files[0];
        this._addTorrent(path, config, this.handleError(cb))
    }.bind(this))
}

Deluge.prototype.addTorrentURL = function(url, config, cb) {
    this._rpc('web.download_torrent_from_url', [url, ''], function(err, res, body) {
        if (err) {
            return cb(...arguments)
        }
        const path = body.result
        this._addTorrent(path, config, this.handleError(cb))
    }.bind(this))
}

Deluge.prototype._doAction = function(method, hash, params, cb) {
    let torrents = Array.isArray(hash) ? hash : [hash]
    this._rpc(method, [torrents, ...params], this.handleError(cb))
}

/*
 * For RPC calls not supporting multiple torrent hashes this may be used.
 * It will call the RPC call once for every torrent hash provided
*/
Deluge.prototype._doMultiAction = function(method, hash, params, cb) {
    let torrents = Array.isArray(hash) ? hash : [hash]
    let counter = 0
    for (let hash of torrents) {
        this._rpc(method, [hash, ...params], this.handleError(function() {
            counter ++
            if (torrents.length === counter) {
                cb(...arguments)
            }
        }.bind(this)))
    }
}

Deluge.prototype.pause = function(hash, cb) {
    this._doAction('core.pause_torrent', hash, [], cb)
}

Deluge.prototype.resume = function(hash, cb) {
    this._doAction('core.resume_torrent', hash, [], cb)
}

Deluge.prototype.verify = function(hash, cb) {
    this._doAction('core.force_recheck', hash, [], cb)
}

Deluge.prototype.queueTop = function(hash, cb) {
    this._doAction('core.queue_top', hash, [], cb)
}

Deluge.prototype.queueBottom = function(hash, cb) {
    this._doAction('core.queue_bottom', hash, [], cb)
}

Deluge.prototype.queueUp = function(hash, cb) {
    this._doAction('core.queue_up', hash, [], cb)
}

Deluge.prototype.queueDown = function(hash, cb) {
    this._doAction('core.queue_down', hash, [], cb)
}

/* N.B. will call API once for every torrent provided */
Deluge.prototype.remove = function(hash, cb) {
    this._doMultiAction('core.remove_torrent', hash, [false], cb)
}

/* N.B. will call API once for every torrent provided */
Deluge.prototype.removeAndDelete = function(hash, cb) {
    this._doMultiAction('core.remove_torrent', hash, [true], cb)
}

module.exports = Deluge