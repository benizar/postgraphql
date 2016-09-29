import { GraphQLSchema, GraphQLObjectType, GraphQLFieldConfig, GraphQLNonNull } from 'graphql'
import { Inventory } from '../../interface'
import buildObject from '../utils/buildObject'
import createNodeFieldEntry from './node/createNodeFieldEntry'
import getCollectionType from './collection/getCollectionType'
import createCollectionQueryFieldEntries from './collection/createCollectionQueryFieldEntries'
import BuildToken from './BuildToken'

export type SchemaOptions = {
  // The exact name for the node id field. In the past Relay wanted this to
  // be `id`, but there are some movements in the GraphQL standard to
  // standardize an `__id` field.
  nodeIdFieldName?: string,
}

/**
 * Creates a GraphQL schema using an instance of `Inventory`.
 */
export default function createGraphqlSchema (inventory: Inventory, options: SchemaOptions = {}): GraphQLSchema {
  // We take our user-friendly arguments to `createGraphqlSchema` and convert them
  // into a build token. One nice side effect of always creating our own
  // build token object is that we have the guarantee that every build token
  // will always maintain its own memoization map.
  const buildToken: BuildToken = {
    inventory,
    options: {
      // The default node id field name is `__id` as it is the emerging
      // standard.
      nodeIdFieldName: options.nodeIdFieldName || '__id',
    },
  }

  return new GraphQLSchema({
    query: createQueryType(buildToken),
    types: [
      // Make sure to always include the types for our collections, even if
      // they have no other output.
      ...inventory.getCollections().map(collection => getCollectionType(buildToken, collection)),
    ],
  })
}

// TODO: doc
function createQueryType (buildToken: BuildToken): GraphQLObjectType<mixed> {
  const { inventory } = buildToken
  let queryType: GraphQLObjectType<mixed>

  queryType = new GraphQLObjectType({
    name: 'Query',
    // TODO: description
    fields: () => buildObject<GraphQLFieldConfig<mixed, mixed>>(
      [
        createNodeFieldEntry(buildToken),
      ],
      inventory
        .getCollections()
        .map(collection => createCollectionQueryFieldEntries(buildToken, collection))
        .reduce((a, b) => a.concat(b), []),
      [
        ['relay', {
          description: 'Exposes the root query type nested one level down. This is helpful for Relay 1 which can only query top level fields if they are in a particular form.',
          type: new GraphQLNonNull(queryType),
          resolve: source => source || {},
        }],
      ],
    ),
  })

  return queryType
}