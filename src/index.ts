import { setupPersistenceClient } from './persistence'
import { applyRemoteBreak, applyRemoteLay, applyRemotePaint, setupGame } from './game'
import { setupUi } from './ui'

export function main() {
  setupGame()
  setupUi()
  setupPersistenceClient({ applyRemoteLay, applyRemoteBreak, applyRemotePaint })
}
