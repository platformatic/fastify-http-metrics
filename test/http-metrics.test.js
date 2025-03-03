'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { setTimeout: sleep } = require('node:timers/promises')
const { request } = require('undici')
const { Registry } = require('prom-client')
const httpMetrics = require('../index.js')
const { createFastifyApp, calculateEpsilon } = require('./helper.js')

test('should calculate the http request duration histogram', async (t) => {
  const app = createFastifyApp()

  const registry = new Registry()
  app.register(httpMetrics, { registry })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const serverUrl = `http://localhost:${app.server.address().port}`
  await Promise.all([
    request(serverUrl + '/dynamic_delay', { query: { delay: 500 } }),
    request(serverUrl + '/dynamic_delay', { query: { delay: 1000 } }),
    request(serverUrl + '/dynamic_delay', { query: { delay: 2000 } }),
  ])

  const expectedMeasurements = [0.501, 1.001, 2.001]
  const expectedEpsilon = 0.05

  const metrics = await registry.getMetricsAsJSON()
  assert.strictEqual(metrics.length, 2)

  const histogramMetric = metrics.find(
    (metric) => metric.name === 'http_request_duration_seconds'
  )
  assert.strictEqual(histogramMetric.name, 'http_request_duration_seconds')
  assert.strictEqual(histogramMetric.type, 'histogram')
  assert.strictEqual(histogramMetric.help, 'request duration in seconds')
  assert.strictEqual(histogramMetric.aggregator, 'sum')

  const histogramValues = histogramMetric.values

  {
    const histogramCount = histogramValues.find(
      ({ metricName, labels: { route } }) => {
        return metricName === 'http_request_duration_seconds_count' && route !== '/__empty_metrics'
      }
    )
    assert.strictEqual(histogramCount.value, expectedMeasurements.length)
  }

  {
    const histogramSum = histogramValues.find(
      ({ metricName, labels: { route } }) => {
        return metricName === 'http_request_duration_seconds_sum' && route !== '/__empty_metrics'
      }
    )
    const value = histogramSum.value
    const expectedValue = expectedMeasurements.reduce((a, b) => a + b, 0)
    const epsilon = calculateEpsilon(value, expectedValue)
    assert.ok(
      epsilon < expectedEpsilon,
      `expected ${expectedValue}, got ${value}, epsilon ${epsilon}`
    )
  }

  for (const { metricName, labels, value } of histogramValues) {
    assert.strictEqual(labels.method, 'GET')
    assert.strictEqual(labels.status_code, 200)

    if (metricName !== 'http_request_duration_seconds_bucket') continue

    const expectedBucketMeasurements = expectedMeasurements.filter((m) => {
      let le = labels.le
      if (le === '+Inf') le = Infinity
      if (le === '-Inf') le = -Infinity
      return m < le
    })

    const expectedValue = expectedBucketMeasurements.length
    assert.strictEqual(
      value, expectedValue,
      `le ${labels.le}: expected ${JSON.stringify(expectedBucketMeasurements)}`
    )
  }

  const summaryMetric = metrics.find(
    (metric) => metric.name === 'http_request_summary_seconds'
  )
  assert.strictEqual(summaryMetric.name, 'http_request_summary_seconds')
  assert.strictEqual(summaryMetric.type, 'summary')
  assert.strictEqual(summaryMetric.help, 'request duration in seconds summary')
  assert.strictEqual(summaryMetric.aggregator, 'sum')

  const summaryValues = summaryMetric.values

  {
    const summaryCount = summaryValues.find(
      ({ metricName }) => metricName === 'http_request_summary_seconds_count'
    )
    assert.strictEqual(summaryCount.value, expectedMeasurements.length)
  }

  {
    const summarySum = summaryValues.find(
      ({ metricName }) => metricName === 'http_request_summary_seconds_sum'
    )
    const value = summarySum.value
    const expectedValue = expectedMeasurements.reduce((a, b) => a + b, 0)
    const epsilon = calculateEpsilon(value, expectedValue)
    assert.ok(
      epsilon < expectedEpsilon,
      `expected ${expectedValue}, got ${value}, epsilon ${epsilon}`
    )
  }

  const expectedSummaryValues = {
    0.01: expectedMeasurements[0],
    0.05: expectedMeasurements[0],
    0.5: expectedMeasurements[1],
    0.9: expectedMeasurements[2],
    0.95: expectedMeasurements[2],
    0.99: expectedMeasurements[2],
    0.999: expectedMeasurements[2],
  }

  for (const { labels, value } of summaryValues) {
    assert.strictEqual(labels.method, 'GET')
    assert.strictEqual(labels.status_code, 200)

    const quantile = labels.quantile
    if (quantile === undefined) continue

    const expectedValue = expectedSummaryValues[quantile]
    const epsilon = calculateEpsilon(value, expectedValue)

    assert.ok(
      epsilon < expectedEpsilon,
      `expected ${expectedValue}, got ${value}, epsilon ${epsilon}`
    )
  }
})

test('should ignore some methods and routes', async (t) => {
  const app = createFastifyApp()

  const registry = new Registry()
  app.register(httpMetrics, {
    registry,
    ignoreRoutes: ['/2s'],
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const serverUrl = `http://localhost:${app.server.address().port}`
  await Promise.all([
    request(serverUrl + '/1s', { method: 'HEAD' }),
    request(serverUrl + '/1s', { method: 'POST' }),
    request(serverUrl + '/1s', { method: 'OPTION' }),
    request(serverUrl + '/1s', { method: 'DELETE' }),

    request(serverUrl + '/2s', { method: 'HEAD' }),
    request(serverUrl + '/2s', { method: 'POST' }),
    request(serverUrl + '/2s', { method: 'OPTION' }),
    request(serverUrl + '/2s', { method: 'DELETE' }),
  ])

  const metrics = await registry.getMetricsAsJSON()
  assert.strictEqual(metrics.length, 2)

  const histogramMetric = metrics.find(
    (metric) => metric.name === 'http_request_duration_seconds'
  )

  const histogramValues = histogramMetric.values

  {
    const head1sMetrics = histogramValues.filter(
      ({ labels }) => labels.method === 'HEAD' && labels.route === '/1s'
    )
    assert.strictEqual(head1sMetrics.length, 0)
  }

  {
    const option1sMetrics = histogramValues.filter(
      ({ labels }) => labels.method === 'OPTION' && labels.route === '/1s'
    )
    assert.strictEqual(option1sMetrics.length, 0)
  }

  {
    const post1sMetrics = histogramValues.filter(
      ({ labels }) => labels.method === 'POST' && labels.route === '/1s'
    )
    assert.strictEqual(post1sMetrics.length, 14)

    for (const { labels } of post1sMetrics) {
      assert.strictEqual(labels.method, 'POST')
      assert.strictEqual(labels.status_code, 200)
      assert.strictEqual(labels.route, '/1s')
    }
  }

  {
    const delete1sMetrics = histogramValues.filter(
      ({ labels }) => labels.method === 'DELETE' && labels.route === '/1s'
    )
    assert.strictEqual(delete1sMetrics.length, 14)

    for (const { labels } of delete1sMetrics) {
      assert.strictEqual(labels.method, 'DELETE')
      assert.strictEqual(labels.status_code, 200)
      assert.strictEqual(labels.route, '/1s')
    }
  }

  {
    const all2sMetrics = histogramValues.filter(
      ({ labels }) => labels.route === '/2s'
    )
    assert.strictEqual(all2sMetrics.length, 0)
  }
})

test('should ignore route with a callback', async (t) => {
  const app = createFastifyApp()

  const registry = new Registry()
  app.register(httpMetrics, {
    registry,
    ignore: (req) => req.headers['x-ignore'] === 'true',
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const serverUrl = `http://localhost:${app.server.address().port}`
  await Promise.all([
    request(serverUrl + '/1s', {
      method: 'GET',
      headers: { 'x-ignore': 'true' },
    }),
    request(serverUrl + '/1s', {
      method: 'POST',
      headers: { 'x-ignore': 'false' },
    }),
  ])

  const metrics = await registry.getMetricsAsJSON()
  assert.strictEqual(metrics.length, 2)

  const histogramMetric = metrics.find(
    (metric) => metric.name === 'http_request_duration_seconds'
  )

  const histogramValues = histogramMetric.values

  {
    const ignoredMetrics = histogramValues.filter(
      ({ labels }) => labels.method === 'GET'
    )
    assert.strictEqual(ignoredMetrics.length, 0)
  }

  {
    const notIgnoredMetrics = histogramValues.filter(
      ({ labels }) => labels.method === 'POST'
    )
    assert.strictEqual(notIgnoredMetrics.length, 14)

    for (const { labels } of notIgnoredMetrics) {
      assert.strictEqual(labels.method, 'POST')
      assert.strictEqual(labels.status_code, 200)
    }
  }
})

test('should calculate the http request duration histogram for injects', async (t) => {
  const app = createFastifyApp()

  const registry = new Registry()
  app.register(httpMetrics, { registry })

  await app.ready()
  t.after(() => app.close())

  await Promise.all([
    app.inject({ path: '/dynamic_delay', query: { delay: 500 } }),
    app.inject({ path: '/dynamic_delay', query: { delay: 1000 } }),
    app.inject({ path: '/dynamic_delay', query: { delay: 2000 } }),
  ])

  const expectedMeasurements = [0.501, 1.001, 2.001]
  const expectedEpsilon = 0.05

  const metrics = await registry.getMetricsAsJSON()
  assert.strictEqual(metrics.length, 2)

  const histogramMetric = metrics.find(
    (metric) => metric.name === 'http_request_duration_seconds'
  )
  assert.strictEqual(histogramMetric.name, 'http_request_duration_seconds')
  assert.strictEqual(histogramMetric.type, 'histogram')
  assert.strictEqual(histogramMetric.help, 'request duration in seconds')
  assert.strictEqual(histogramMetric.aggregator, 'sum')

  const histogramValues = histogramMetric.values

  {
    const histogramCount = histogramValues.find(
      ({ metricName, labels: { route } }) => metricName === 'http_request_duration_seconds_count' && route !== '/__empty_metrics'
    )
    assert.strictEqual(histogramCount.value, expectedMeasurements.length)
  }

  {
    const histogramSum = histogramValues.find(
      ({ metricName, labels: { route } }) => metricName === 'http_request_duration_seconds_sum' && route !== '/__empty_metrics'
    )
    const value = histogramSum.value
    const expectedValue = expectedMeasurements.reduce((a, b) => a + b, 0)
    const epsilon = calculateEpsilon(value, expectedValue)
    assert.ok(
      epsilon < expectedEpsilon,
      `expected ${expectedValue}, got ${value}, epsilon ${epsilon}`
    )
  }

  for (const { metricName, labels, value } of histogramValues) {
    if (labels.route === '/__empty_metrics') continue

    assert.strictEqual(labels.method, 'GET')
    assert.strictEqual(labels.status_code, 200)

    if (metricName !== 'http_request_duration_seconds_bucket') continue

    const expectedBucketMeasurements = expectedMeasurements.filter((m) => {
      let le = labels.le
      if (le === '+Inf') le = Infinity
      if (le === '-Inf') le = -Infinity
      return m < le
    })

    const expectedValue = expectedBucketMeasurements.length
    assert.strictEqual(
      value, expectedValue,
      `le ${labels.le}: expected ${JSON.stringify(expectedBucketMeasurements)}`
    )
  }

  const summaryMetric = metrics.find(
    (metric) => metric.name === 'http_request_summary_seconds'
  )
  assert.strictEqual(summaryMetric.name, 'http_request_summary_seconds')
  assert.strictEqual(summaryMetric.type, 'summary')
  assert.strictEqual(summaryMetric.help, 'request duration in seconds summary')
  assert.strictEqual(summaryMetric.aggregator, 'sum')

  const summaryValues = summaryMetric.values

  {
    const summaryCount = summaryValues.find(
      ({ metricName }) => metricName === 'http_request_summary_seconds_count'
    )
    assert.strictEqual(summaryCount.value, expectedMeasurements.length)
  }

  {
    const summarySum = summaryValues.find(
      ({ metricName }) => metricName === 'http_request_summary_seconds_sum'
    )
    const value = summarySum.value
    const expectedValue = expectedMeasurements.reduce((a, b) => a + b, 0)
    const epsilon = calculateEpsilon(value, expectedValue)
    assert.ok(
      epsilon < expectedEpsilon,
      `expected ${expectedValue}, got ${value}, epsilon ${epsilon}`
    )
  }

  const expectedSummaryValues = {
    0.01: expectedMeasurements[0],
    0.05: expectedMeasurements[0],
    0.5: expectedMeasurements[1],
    0.9: expectedMeasurements[2],
    0.95: expectedMeasurements[2],
    0.99: expectedMeasurements[2],
    0.999: expectedMeasurements[2],
  }

  for (const { labels, value } of summaryValues) {
    assert.strictEqual(labels.method, 'GET')
    assert.strictEqual(labels.status_code, 200)

    const quantile = labels.quantile
    if (quantile === undefined) continue

    const expectedValue = expectedSummaryValues[quantile]
    const epsilon = calculateEpsilon(value, expectedValue)

    assert.ok(
      epsilon < expectedEpsilon,
      `expected ${expectedValue}, got ${value}, epsilon ${epsilon}`
    )
  }
})

test('should not throw if request timers are not found', async (t) => {
  const app = createFastifyApp({
    logger: {
      level: 'error',
      hooks: {
        logMethod (args, method, level) {
          if (level === 50) {
            assert.fail('should not log error')
          }
          return method.apply(this, args)
        }
      }
    }
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.code(401)
    reply.send('Failed to handle request')
    return reply
  })

  const registry = new Registry()
  app.register(httpMetrics, { registry })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const serverUrl = `http://localhost:${app.server.address().port}`
  const responsePromise = request(serverUrl + '/dynamic_delay', {
    query: {
      delay: 1000
    }
  })
  // Wait for server to receive the request
  await sleep(500)
  const { statusCode } = await responsePromise
  assert.strictEqual(statusCode, 401)

  const metrics = await registry.getMetricsAsJSON()
  assert.strictEqual(metrics.length, 2)
  const histogramMetric = metrics.find(
    (metric) => metric.name === 'http_request_duration_seconds'
  )
  const histogramValues = histogramMetric.values
  assert.strictEqual(histogramValues.length, 0)
})

test('should provide a default timer value so that the summary and histogram are not empty', async (t) => {
  const app = createFastifyApp()

  const registry = new Registry()
  app.register(httpMetrics, { registry, zeroFill: true })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const metrics = await registry.getMetricsAsJSON()
  assert.strictEqual(metrics.length, 2)

  const histogramMetric = metrics.find(
    (metric) => metric.name === 'http_request_duration_seconds'
  )
  assert.strictEqual(histogramMetric.name, 'http_request_duration_seconds')
  assert.strictEqual(histogramMetric.type, 'histogram')
  assert.strictEqual(histogramMetric.help, 'request duration in seconds')
  assert.strictEqual(histogramMetric.aggregator, 'sum')

  const histogramValues = histogramMetric.values

  {
    const histogramCount = histogramValues.find(
      ({ metricName }) => metricName === 'http_request_duration_seconds_count'
    )
    assert.strictEqual(histogramCount.value, 0)
  }

  {
    const histogramSum = histogramValues.find(
      ({ metricName }) => metricName === 'http_request_duration_seconds_sum'
    )
    const value = histogramSum.value
    assert.ok(
      value < 0.1
    )
  }

  for (const { metricName, labels, value } of histogramValues) {
    assert.strictEqual(labels.method, 'GET')
    assert.strictEqual(labels.status_code, 404)

    if (metricName !== 'http_request_duration_seconds_bucket') continue

    assert.strictEqual(value, 0)
  }

  const summaryMetric = metrics.find(
    (metric) => metric.name === 'http_request_summary_seconds'
  )
  assert.strictEqual(summaryMetric.name, 'http_request_summary_seconds')
  assert.strictEqual(summaryMetric.type, 'summary')
  assert.strictEqual(summaryMetric.help, 'request duration in seconds summary')
  assert.strictEqual(summaryMetric.aggregator, 'sum')

  const summaryValues = summaryMetric.values

  {
    const summaryCount = summaryValues.find(
      ({ metricName }) => metricName === 'http_request_summary_seconds_count'
    )
    assert.strictEqual(summaryCount.value, 1)
  }

  {
    const summarySum = summaryValues.find(
      ({ metricName }) => metricName === 'http_request_summary_seconds_sum'
    )
    const value = summarySum.value
    assert.ok(
      value < 0.1
    )
  }

  for (const { labels, value } of summaryValues) {
    assert.strictEqual(labels.method, 'GET')
    assert.strictEqual(labels.status_code, 404)

    const quantile = labels.quantile
    if (quantile === undefined) continue

    assert.ok(
      value < 0.1
    )
  }
})
