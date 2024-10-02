import { createRequire } from 'node:module'
import path from 'node:path'

import { jest } from '@jest/globals'

import {
  _dirname,
  setupReceiveMessageOnPortMock,
  testIf,
  tsUseEsmSupported,
} from './helpers.js'
import type { AsyncWorkerFn } from './types.js'

import { createSyncFn } from 'synckit'

const { SYNCKIT_TIMEOUT } = process.env

beforeEach(() => {
  jest.resetModules()
  jest.restoreAllMocks()

  delete process.env.SYNCKIT_GLOBAL_SHIMS

  if (SYNCKIT_TIMEOUT) {
    process.env.SYNCKIT_TIMEOUT = SYNCKIT_TIMEOUT
  } else {
    delete process.env.SYNCKIT_TIMEOUT
  }
})

const cjsRequire = createRequire(import.meta.url)

const workerCjsTsPath = path.resolve(_dirname, 'cjs/worker-cjs.ts')
const workerEsmTsPath = path.resolve(_dirname, 'esm/worker-esm.ts')
const workerNoExtAsJsPath = path.resolve(_dirname, 'worker-js')
const workerJsAsTsPath = path.resolve(_dirname, 'worker.js')
const workerCjsPath = path.resolve(_dirname, 'worker.cjs')
const workerMjsPath = path.resolve(_dirname, 'worker.mjs')
const workerErrorPath = path.resolve(_dirname, 'worker-error.cjs')

test('ts as cjs', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsTsPath)
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

testIf(tsUseEsmSupported)('ts as esm', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerEsmTsPath)
  /* eslint-disable jest/no-standalone-expect */
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
  /* eslint-enable jest/no-standalone-expect */
})

test('no ext as js (as esm)', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerNoExtAsJsPath)
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
})

testIf(tsUseEsmSupported)('js as ts (as esm)', () => {
  const syncFn = createSyncFn<AsyncWorkerFn>(workerJsAsTsPath)
  /* eslint-disable jest/no-standalone-expect */
  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5)).toBe(5)
  /* eslint-enable jest/no-standalone-expect */
})

test('createSyncFn', () => {
  expect(() => createSyncFn('./fake')).toThrow('`workerPath` must be absolute')
  expect(() => createSyncFn(cjsRequire.resolve('eslint'))).not.toThrow()

  const syncFn1 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  const syncFn2 = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  const syncFn3 = createSyncFn<AsyncWorkerFn>(workerMjsPath)

  const errSyncFn = createSyncFn<() => Promise<void>>(workerErrorPath)

  expect(syncFn1).toBe(syncFn2)
  expect(syncFn1).not.toBe(syncFn3)
  expect(syncFn1(1)).toBe(1)
  expect(syncFn1(2)).toBe(2)
  expect(syncFn1(5, 0)).toBe(5)

  expect(syncFn3(1)).toBe(1)
  expect(syncFn3(2)).toBe(2)
  expect(syncFn3(5, 0)).toBe(5)

  expect(() => errSyncFn()).toThrowErrorMatchingInlineSnapshot(`"Worker Error"`)

  const syncFn4 = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(syncFn4(1)).toBe(1)
  expect(syncFn4(2)).toBe(2)
  expect(syncFn4(5, 0)).toBe(5)
})

test('timeout', async () => {
  process.env.SYNCKIT_TIMEOUT = '1'

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(() => syncFn(1, 100)).toThrow(
    'Internal error: Atomics.wait() failed: timed-out',
  )
})

test('subsequent executions after timeout', async () => {
  const executionTimeout = 30
  const longRunningTaskDuration = executionTimeout * 10
  process.env.SYNCKIT_TIMEOUT = executionTimeout.toString()

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  // start an execution in worker that will definitely time out
  expect(() => syncFn(1, longRunningTaskDuration)).toThrow()

  // wait for timed out execution to finish inside worker
  await new Promise(resolve => setTimeout(resolve, longRunningTaskDuration))

  // subsequent executions should work correctly
  expect(syncFn(2, 1)).toBe(2)
  expect(syncFn(3, 1)).toBe(3)
})

test('handling of outdated message from worker', async () => {
  const synckitTimeout = 60
  process.env.SYNCKIT_TIMEOUT = synckitTimeout.toString()
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  jest.spyOn(Atomics, 'wait').mockReturnValue('ok')

  receiveMessageOnPortMock
    .mockReturnValueOnce({ message: { id: -1 } })
    .mockReturnValueOnce({ message: { id: 0, result: 1 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)
  expect(receiveMessageOnPortMock).toHaveBeenCalledTimes(2)
})

test('propagation of undefined timeout', async () => {
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  jest.spyOn(Atomics, 'wait').mockReturnValue('ok')

  receiveMessageOnPortMock
    .mockReturnValueOnce({ message: { id: -1 } })
    .mockReturnValueOnce({ message: { id: 0, result: 1 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)
  expect(receiveMessageOnPortMock).toHaveBeenCalledTimes(2)

  const [firstAtomicsWaitArgs, secondAtomicsWaitArgs] = (
    Atomics.wait as unknown as jest.SpiedFunction<typeof Atomics.wait>
  ).mock.calls
  const [, , , firstAtomicsWaitCallTimeout] = firstAtomicsWaitArgs
  const [, , , secondAtomicsWaitCallTimeout] = secondAtomicsWaitArgs

  expect(typeof firstAtomicsWaitCallTimeout).toBe('undefined')
  expect(typeof secondAtomicsWaitCallTimeout).toBe('undefined')
})

test('reduction of waiting time', async () => {
  const synckitTimeout = 60
  process.env.SYNCKIT_TIMEOUT = synckitTimeout.toString()
  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()

  jest.spyOn(Atomics, 'wait').mockImplementation(() => {
    const start = Date.now()
    // simulate waiting 10ms for worker to respond
    while (Date.now() - start < 10) {
      continue
    }

    return 'ok'
  })

  receiveMessageOnPortMock
    .mockReturnValueOnce({ message: { id: -1 } })
    .mockReturnValueOnce({ message: { id: 0, result: 1 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(syncFn(1)).toBe(1)
  expect(receiveMessageOnPortMock).toHaveBeenCalledTimes(2)

  const [firstAtomicsWaitArgs, secondAtomicsWaitArgs] = (
    Atomics.wait as unknown as jest.SpiedFunction<typeof Atomics.wait>
  ).mock.calls
  const [, , , firstAtomicsWaitCallTimeout] = firstAtomicsWaitArgs
  const [, , , secondAtomicsWaitCallTimeout] = secondAtomicsWaitArgs

  expect(typeof firstAtomicsWaitCallTimeout).toBe('number')
  expect(firstAtomicsWaitCallTimeout).toBe(synckitTimeout)
  expect(typeof secondAtomicsWaitCallTimeout).toBe('number')
  expect(secondAtomicsWaitCallTimeout).toBeLessThan(synckitTimeout)
})

test('unexpected message from worker', async () => {
  jest.spyOn(Atomics, 'wait').mockReturnValue('ok')

  const receiveMessageOnPortMock = await setupReceiveMessageOnPortMock()
  receiveMessageOnPortMock.mockReturnValueOnce({ message: { id: 100 } })

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)
  expect(() => syncFn(1)).toThrow(
    'Internal error: Expected id 0 but got id 100',
  )
})

test('globalShims env', async () => {
  process.env.SYNCKIT_GLOBAL_SHIMS = '1'

  const { createSyncFn } = await import('synckit')
  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath)

  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5, 0)).toBe(5)
})

test('globalShims options', async () => {
  const { createSyncFn } = await import('synckit')

  const syncFn = createSyncFn<AsyncWorkerFn>(workerCjsPath, {
    globalShims: [
      {
        moduleName: 'non-existed',
      },
    ],
  })

  expect(syncFn(1)).toBe(1)
  expect(syncFn(2)).toBe(2)
  expect(syncFn(5, 0)).toBe(5)
})
