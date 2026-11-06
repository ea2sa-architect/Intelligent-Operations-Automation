import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Without vitest's `globals: true`, @testing-library/react's automatic
// afterEach(cleanup) never registers, so each render() in a test file leaves
// its DOM behind for the next one — wire it up explicitly instead.
afterEach(cleanup)

// jsdom has no ResizeObserver; recharts' <ResponsiveContainer> (used on the
// Workflow Governance summary tab, which mounts by default) needs one just
// to construct, even though layout itself isn't meaningful under jsdom.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom's Blob/File has no text() (every real browser does); the policy bundle
// import reads its file with it.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}
