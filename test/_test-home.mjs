import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function testHome(name) {
  return process.env.DSH_TEST_HOME || join(tmpdir(), `${name}-${process.pid}`)
}
