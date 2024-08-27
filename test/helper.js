'use strict'

const { setTimeout: sleep } = require('node:timers/promises')
const fastify = require('fastify')

function createFastifyApp (t) {
  const app = fastify()

  app.all('/500ms', async () => {
    await sleep(500)
    return 'Hello World\n'
  })

  app.all('/1s', async () => {
    await sleep(1000)
    return 'Hello World\n'
  })

  app.all('/2s', async () => {
    await sleep(2000)
    return 'Hello World\n'
  })

  app.all('/dynamic_delay', async (request) => {
    const delay = request.query.delay
    await sleep(delay)
    return 'Hello World\n'
  })

  return app
}

function calculateEpsilon (value, expectedValue) {
  return Math.abs(value - expectedValue) / expectedValue
}

module.exports = {
  createFastifyApp,
  calculateEpsilon,
}
