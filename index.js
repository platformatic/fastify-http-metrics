'use strict'

const { Histogram, Summary } = require('prom-client')
const fp = require('fastify-plugin')

const defaultLabels = ['method', 'route', 'status_code']
const defaultIgnoreMethods = ['HEAD', 'OPTIONS', 'TRACE', 'CONNECT']

module.exports = fp(async function (fastify, opts) {
  const getCustomLabels = opts.getCustomLabels || (() => ({}))
  const customLabelNames = opts.customLabels || []

  const labelNames = [...new Set([...defaultLabels, ...customLabelNames])]

  const registers = [opts.registry]

  const ignoreMethods = opts.ignoreMethods || defaultIgnoreMethods
  const ignoreRoutes = opts.ignoreRoutes || []
  const ignore = opts.ignore || (() => false)

  function ignoreRoute (request) {
    if (ignoreMethods.includes(request.method)) return true

    const routePath = request.routeOptions.url ?? 'unknown'
    if (ignoreRoutes.includes(routePath)) return true

    return false
  }

  const summary = new Summary({
    name: 'http_request_summary_seconds',
    help: 'request duration in seconds summary',
    labelNames,
    registers,
    ...opts.summary,
  })

  const histogram = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'request duration in seconds',
    labelNames,
    registers,
    ...opts.histogram,
  })

  const timers = new WeakMap()

  fastify.addHook('onRequest', async (req) => {
    if (ignoreRoute(req)) return

    const summaryTimer = summary.startTimer()
    const histogramTimer = histogram.startTimer()

    timers.set(req, { summaryTimer, histogramTimer })
  })

  fastify.addHook('onResponse', async (req, reply) => {
    if (ignoreRoute(req)) return

    const requestTimers = timers.get(req)
    if (!requestTimers) return

    const { summaryTimer, histogramTimer } = requestTimers
    timers.delete(req)

    if (ignore(req, reply)) return

    const routePath = req.routeOptions.url ?? 'unknown'
    const labels = {
      method: req.method,
      route: routePath,
      status_code: reply.statusCode,
      ...getCustomLabels(req, reply),
    }

    if (summaryTimer) summaryTimer(labels)
    if (histogramTimer) histogramTimer(labels)
  })
}, {
  name: 'fastify-http-metrics'
})
