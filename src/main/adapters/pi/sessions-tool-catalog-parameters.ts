import { Type } from 'typebox'

/** Which part of the Session catalog list, search, and delegations_list look at. */
export const sessionsToolCatalogScope = Type.Optional(
  Type.Union([Type.Literal('current'), Type.Literal('project'), Type.Literal('all')]),
)

/** The discovery actions ignore `projectPath` unless catalogScope is `project`. */
export const sessionsToolProjectPath = Type.Optional(
  Type.String({
    description:
      'Absolute path of a project in OpenWaggle, as list shows it. For list, search, delegations_list, and delegations_conflicts it applies only with catalogScope project.',
  }),
)
