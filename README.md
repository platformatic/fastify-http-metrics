# @platformatic/fastify-http-metrics

The `fastify-http-metrics` package provides a simple way to collect prometheus metrics for your Fastify application.

## Installation

```bash
npm install @platformatic/fastify-http-metrics
```

## Usage

```javascript
const { Registry } = require('prom-client')
const fastify = require('fastify')
const httpMetrics = require('@platformatic/fastify-http-metrics')

const app = fastify()

const registry = new Registry()
app.register(httpMetrics, { registry })

app.get('/metrics', async () => {
  const metrics = await registry.metrics()
  return metrics
})

app.get('/', async () => {
  return 'Hello World'
})

app.listen({ port: 0 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening on ${address}`)
})
```

## API

#### httpMetrics plugin options

- __`options`__ `<object>` Options for configuring the metrics collection.
  - __`registry`__ `<Registry>` The prom-client registry to use for collecting metrics.
  - __`customLabels`__ `<array>` A list of custom labels names to add to the metrics.
  - __`getCustomLabels(req, res, server)`__ `<function>` A function that returns an object of custom labels to add to the metrics. The function receives the request object as a first argument and a response object as a second argument.
  - __`ignoreMethods`__ `<array>` A list of HTTP methods to ignore when collecting metrics. Default: `['OPTIONS', 'HEAD', 'CONNECT', 'TRACE']`.
  - __`ignoreRoutes`__ `<array>` A list of fastify routes to ignore when collecting metrics. Default: `[]`.
  - __`ignore(req, res, server)`__ `<function>` A function that returns a boolean indicating whether to ignore the request when collecting metrics. The function receives the request object as a first argument and a response object as a second argument.
  - __`histogram`__ `<object>` prom-client [histogram options](https://github.com/siimon/prom-client?tab=readme-ov-file#histogram). Use it if you want to customize the histogram.
  - __`summary`__ `<object>` prom-client [summary options](https://github.com/siimon/prom-client?tab=readme-ov-file#summary). Use it if you want to customize the summary.

## License

Apache-2.0

