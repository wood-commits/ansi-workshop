import { BROKER_PORT, createBroker, newToken } from './broker.js'

const ownerToken = newToken()
const server = createBroker(ownerToken)
server.once('error', error => {
  console.error('Cannot start the agent broker:', error.message)
  process.exitCode = 1
})
server.listen(BROKER_PORT, '127.0.0.1', () => {
  console.log(`ANSI Workshop agent broker listening on 127.0.0.1:${BROKER_PORT}.`)
  console.log('Paste the following OWNER key into the editor Agent access panel. Never give it to an agent:')
  console.log(ownerToken)
  console.log('Issue separate agent tokens in the editor. All credentials expire when this process stops.')
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(); server.closeAllConnections() })
}
