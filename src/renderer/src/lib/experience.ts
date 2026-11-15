import { experienceMonths } from '../../../shared/profile'
import { api } from './api'
import { useData } from './data'

/**
 * The user's experience in months, from the roles in their profile, for the
 * referral rule. null when no role has dates (nothing then blocks an ask);
 * also null while the profile loads, since the main process checks again.
 */
export function useExperience(): number | null {
  const settings = useData(() => api.settings.get(), [], ['settings'])
  return settings.data ? experienceMonths(settings.data.profile) : null
}
