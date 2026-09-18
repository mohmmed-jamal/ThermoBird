/**
 * solverStorage.ts  — re-exports DB-backed solver script helpers.
 * Previously used localStorage; now all data lives in the backend DB.
 * This file is kept for import-path compatibility with existing code.
 */
export {
  saveSolverScript,
  listSolverScripts,
  deleteSolverScript,
  type SolverScriptRow,
} from './api'
