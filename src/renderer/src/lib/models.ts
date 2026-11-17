import { DEFAULT_MODEL } from '../../../shared/types'
import type { ClaudeModel } from '../../../shared/types'

/** The default and the latest of each family come first; pinned older versions after. */
export const isLatest = (model: ClaudeModel): boolean => !model.value.startsWith('claude-')

/**
 * A model in a word or two, as the chat's button shows it. The default is
 * named by the model it stands for now, such as "Opus 5.5".
 */
export function modelName(value: string, models: ClaudeModel[]): string {
  const row = models.find(one => one.value === value)
  if (value === DEFAULT_MODEL) {
    const same = row?.resolved ? models.find(one => one.value !== DEFAULT_MODEL && one.resolved === row.resolved) : undefined
    return same?.name ?? row?.description.split(' · ')[0] ?? 'Default'
  }
  return row?.name ?? value
}

/** A model as a list names it: the default says which model it is now. */
export function modelLabel(model: ClaudeModel, models: ClaudeModel[]): string {
  return model.value === DEFAULT_MODEL ? `${model.name} · ${modelName(model.value, models)}` : model.name
}
