import type { JobAppApi } from '../../shared/api'

declare global {
  interface Window {
    jobApp: JobAppApi
  }
}
