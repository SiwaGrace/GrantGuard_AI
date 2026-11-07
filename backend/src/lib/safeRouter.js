import { Router } from 'express'

// Express 4 doesn't catch errors thrown in async handlers: they become
// unhandled rejections, which crash Node (and `node --watch` then waits for
// a file change, so the server looks "running" but answers nothing).
// This passes every handler's errors to next() so the JSON error handler in
// server.js responds instead.
function wrap(handler) {
  if (typeof handler !== 'function' || handler.length === 4) return handler
  return (req, res, next) => {
    try {
      const result = handler(req, res, next)
      if (result && typeof result.catch === 'function') result.catch(next)
    } catch (err) {
      next(err)
    }
  }
}

export function safeRouter() {
  const router = Router()
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = router[method].bind(router)
    router[method] = (path, ...handlers) => original(path, ...handlers.map(wrap))
  }
  return router
}
