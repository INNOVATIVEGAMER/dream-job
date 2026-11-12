import type { JobAppApi } from '../../preload'

declare global {
  interface Window {
    jobApp: JobAppApi
  }
}
