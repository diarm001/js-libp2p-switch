'use strict'

const race = require('async/race')
const debug = require('debug')
const once = require('once')

const log = debug('libp2p:switch:dialer')

const DialQueue = require('./queue')
const { CONNECTION_FAILED } = require('../errors')

/**
 * Track dials per peer and limited them.
 */
class LimitDialer {
  /**
   * Create a new dialer.
   *
   * @param {number} perPeerLimit
   * @param {number} dialTimeout
   */
  constructor (perPeerLimit, dialTimeout) {
    log('create: %s peer limit, %s dial timeout', perPeerLimit, dialTimeout)
    this.perPeerLimit = perPeerLimit
    this.dialTimeout = dialTimeout
    this.queues = new Map()
  }

  /**
   * Dial a list of multiaddrs on the given transport.
   *
   * @param {PeerId} peer
   * @param {SwarmTransport} transport
   * @param {Array<Multiaddr>} addrs
   * @param {function(Error, Connection)} callback
   * @returns {void}
   */
  dialMany (peer, transport, addrs, callback) {
    log('dialMany:start')
    // we use a token to track if we want to cancel following dials
    const token = { cancel: false }
    callback = once(callback) // only call callback once

    let errors = []
    const tasks = addrs.map((m) => {
      return (cb) => this.dialSingle(peer, transport, m, token, (err, res) => {
        if (res) return cb(null, res)

        errors.push(err || CONNECTION_FAILED())

        if (errors.length === tasks.length) {
          cb(errors)
        }
      })
    })

    race(tasks, (_, successfulDial) => {
      if (successfulDial) {
        log('dialMany:success')
        return callback(null, successfulDial)
      }

      log('dialMany:error')
      return callback(errors)
    })
  }

  /**
   * Dial a single multiaddr on the given transport.
   *
   * @param {PeerId} peer
   * @param {SwarmTransport} transport
   * @param {Multiaddr} addr
   * @param {CancelToken} token
   * @param {function(Error, Connection)} callback
   * @returns {void}
   */
  dialSingle (peer, transport, addr, token, callback) {
    const ps = peer.toB58String()
    log('dialSingle: %s:%s', ps, addr.toString())
    let q
    if (this.queues.has(ps)) {
      q = this.queues.get(ps)
    } else {
      q = new DialQueue(this.perPeerLimit, this.dialTimeout)
      this.queues.set(ps, q)
    }

    q.push(transport, addr, token, callback)
  }
}

module.exports = LimitDialer
