import {
  GraphQLOutputType,
  GraphQLInputType,
  GraphQLScalarType,
  GraphQLInterfaceType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLFieldConfig,
  GraphQLArgumentConfig,
  GraphQLResolveInfo,
  GraphQLEnumType,
  GraphQLEnumValueConfig,
  GraphQLList,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLString,
  Kind,
} from 'graphql'
import { Context, Paginator, Condition, conditionHelpers, Type, NullableType, ObjectType } from '../../../interface'
import { buildObject, formatName, memoize2 } from '../../utils'
import getType from '../getType'
import BuildToken from '../BuildToken'
import transformInputValue from '../transformInputValue'

// TODO: doc
export default function createConnectionField <TValue, TOrdering extends Paginator.Ordering, TCursor, TCondition>(
  buildToken: BuildToken,
  paginator: Paginator<TValue, TOrdering, TCursor>,
  config: {
    withFieldsCondition?: boolean,
    getCondition?: (source: mixed) => Condition,
  } = {},
): GraphQLFieldConfig<mixed, Connection<TValue, TOrdering, TCursor>> {
  const paginatorName = paginator.name

  // If the user wants field conditions, but that paginator type is not an
  // object type, we need to throw an error.
  if (config.withFieldsCondition && !(paginator.type instanceof ObjectType))
    throw new Error('Can only create a connection which has field argument conditions if the paginator type is an object type.')

  // Create our field condition entries. If we are not configured to have such
  // entries, this variable will just be null.
  const fieldConditionEntries: Array<[string, GraphQLArgumentConfig<mixed> & { internalName: string }]> | null =
    config.withFieldsCondition && paginator.type instanceof ObjectType ?
      Array.from(paginator.type.fields).map<[string, GraphQLArgumentConfig<mixed> & { internalName: string }]>(([fieldName, field]) =>
        [formatName.arg(fieldName), {
          // TODO: description
          // Get the type for this field, but always make sure that it is
          // nullable. We don’t want to require conditions.
          type: getType(buildToken, new NullableType(field.type), true),
          // We include this internal name so that we can resolve the arguments
          // back into actual values.
          internalName: fieldName,
        }]
      )
    : null

  // This is the type of all the connection arguments.
  type ConnectionArgs = {
    orderBy: TOrdering,
    before?: NamespacedCursor<TCursor>,
    after?: NamespacedCursor<TCursor>,
    first?: number,
    last?: number,
    condition?: TCondition,
  }

  return {
    type: getConnectionType(buildToken, paginator),
    // TODO: description
    args: buildObject<GraphQLArgumentConfig<mixed>>([
      // Only include an `orderBy` field if there are ways in which we can
      // order.
      paginator.orderings && paginator.orderings.length > 0 && ['orderBy', createOrderByArg(buildToken, paginator)],
      ['before', {
        // TODO: description
        type: _cursorType,
      }],
      ['after', {
        // TODO: description
        type: _cursorType,
      }],
      ['first', {
        // TODO: description
        type: GraphQLInt,
      }],
      ['last', {
        // TODO: description
        type: GraphQLInt,
      }],
      // Add all of the field entries that will eventually make up our
      // condition.
      ...(fieldConditionEntries ? fieldConditionEntries : []),
    ]),
    // Note that this resolver is an arrow function. This is so that we can
    // keep the correct `this` reference.
    async resolve (
      source: mixed,
      args: ConnectionArgs,
      context: mixed,
      info: GraphQLResolveInfo<mixed, mixed>,
    ): Promise<Connection<TValue, TOrdering, TCursor>> {
      if (!(context instanceof Context))
        throw new Error('GraphQL context must be an instance of `Context`.')

      const {
        orderBy: ordering = paginator.defaultOrdering,
        before: beforeCursor,
        after: afterCursor,
        first,
        last,
      } = args

      // Throw an error if the user is trying to use a cursor from another
      // ordering. Note that if no ordering is defined we expect the
      // `orderingName` to be `null`. This is because when we deserialize the
      // base64 encoded JSON any undefineds will become nulls.
      if (beforeCursor && beforeCursor.orderingName !== (ordering ? ordering.name : null))
        throw new Error('`before` cursor can not be used for this `orderBy` value.')
      if (afterCursor && afterCursor.orderingName !== (ordering ? ordering.name : null))
        throw new Error('`after` cursor can not be used for this `orderBy` value.')

      const condition: Condition = conditionHelpers.and(
        // Get an arbitrary condition from our config. If no `getCondition`
        // was provided, the condition is `true`.
        config.getCondition ? config.getCondition(source) : true,
        // For all of our field condition entries, let us add an actual
        // condition to test equality with a given field.
        ...(fieldConditionEntries ? (
          fieldConditionEntries.map(([fieldName, field]) =>
            args[fieldName] !== undefined
              // If the argument exists, create a condition and transform the
              // input value.
              ? conditionHelpers.fieldEquals(field.internalName, transformInputValue(field.type, args[fieldName]))
              // If the argument does not exist, this condition should just be
              // true (which will get filtered out by `conditionHelpers.and`).
              : true
        )) : []),
      )

      // Construct the page config.
      const pageConfig: Paginator.PageConfig<TOrdering, TCursor> = {
        beforeCursor: beforeCursor && beforeCursor.cursor,
        afterCursor: afterCursor && afterCursor.cursor,
        first,
        last,
        ordering,
        condition,
      }

      // Finally, actually get the page data.
      const page = await paginator.readPage(context, pageConfig)

      return {
        paginator,
        ordering,
        // We pass on the condition as it is used by the `Paginator#count`
        // method.
        condition,
        page,
      }
    },
  }
}

const getConnectionType = memoize2(_createConnectionType)

/**
 * Creates a concrete GraphQL connection object type.
 */
export function _createConnectionType <TValue, TOrdering extends Paginator.Ordering, TCursor>(
  buildToken: BuildToken,
  paginator: Paginator<TValue, TOrdering, TCursor>,
): GraphQLObjectType<Connection<TValue, TOrdering, TCursor>> {
  const gqlType = getType(buildToken, paginator.type, false)
  const gqlEdgeType = getEdgeType(buildToken, paginator)

  return new GraphQLObjectType<Connection<TValue, TOrdering, TCursor>>({
    name: formatName.type(`${paginator.name}-connection`),
    // TODO: description
    fields: () => ({
      pageInfo: {
        type: new GraphQLNonNull(_pageInfoType),
        resolve: source => source,
        // TODO: description
      },
      totalCount: {
        type: GraphQLInt,
        resolve: ({ paginator, condition }, args, context) => {
          if (!(context instanceof Context))
            throw new Error('GraphQL context must be an instance of `Context`.')

          return paginator.count(context, condition)
        },
        // TODO: description
      },
      edges: {
        type: new GraphQLList(gqlEdgeType),
        resolve: ({ paginator, ordering, page }): Array<Edge<TValue, TOrdering, TCursor>> =>
          page.values.map(({ cursor, value }) => ({ paginator, ordering, cursor, value })),
        // TODO: description
      },
      nodes: {
        type: new GraphQLList(gqlType),
        resolve: ({ page }): Array<TValue> =>
          page.values.map(({ value }) => value),
        // TODO: description
      },
    }),
  })
}

export const getEdgeType = memoize2(_createEdgeType)

/**
 * Creates a concrete GraphQL edge object type.
 */
export function _createEdgeType <TValue, TOrdering extends Paginator.Ordering, TCursor>(
  buildToken: BuildToken,
  paginator: Paginator<TValue, TOrdering, TCursor>,
): GraphQLObjectType<Edge<TValue, TOrdering, TCursor>> {
  const gqlType = getType(buildToken, paginator.type, false)

  return new GraphQLObjectType<Edge<TValue, TOrdering, TCursor>>({
    name: formatName.type(`${paginator.name}-edge`),
    // TODO: description
    fields: () => ({
      cursor: {
        type: new GraphQLNonNull(_cursorType),
        resolve: ({ ordering, cursor }): NamespacedCursor<TCursor> => ({
          orderingName: ordering ? ordering.name : null,
          cursor,
        }),
        // TODO: description
      },
      node: {
        type: gqlType,
        resolve: ({ value }) => value,
        // TODO: description
      },
    }),
  })
}

/**
 * Creates an argument for the `orderBy` field. The argument will be a correct
 * ordering value for the paginator.
 */
export function createOrderByArg <TValue, TOrdering extends Paginator.Ordering, TCursor>(
  buildToken: BuildToken,
  paginator: Paginator<TValue, TOrdering, TCursor>,
) {
  return {
    // TODO: description
    type: getOrderByEnumType(buildToken, paginator),
    defaultValue: paginator.defaultOrdering,
  }
}

const getOrderByEnumType = memoize2(_createOrderByEnumType)

/**
 * Creates a GraphQL type which can be used by the user to select an ordering
 * strategy.
 */
export function _createOrderByEnumType <TValue, TOrdering extends Paginator.Ordering, TCursor>(
  buildToken: BuildToken,
  paginator: Paginator<TValue, TOrdering, TCursor>,
): GraphQLEnumType<Paginator.Ordering> {
  return new GraphQLEnumType<Paginator.Ordering>({
    name: formatName.type(`${paginator.name}-order-by`),
    // TODO: description
    values: buildObject<GraphQLEnumValueConfig<Paginator.Ordering>>(
      paginator.orderings.map<[string, GraphQLEnumValueConfig<Paginator.Ordering>]>(ordering =>
        [formatName.enumValue(ordering.name), { value: ordering }]
      )
    ),
  })
}

/**
 * The cursor type is a scalar string type that represents a single edge in a
 * connection.
 *
 * @private
 */
export const _cursorType: GraphQLScalarType<NamespacedCursor<mixed>> =
  new GraphQLScalarType<NamespacedCursor<mixed>>({
    name: 'Cursor',
    // TODO: description
    serialize: value => serializeCursor(value),
    parseValue: value => typeof value === 'string' ? deserializeCursor(value) : null,
    parseLiteral: ast => ast.kind === Kind.STRING ? deserializeCursor(ast.value) : null
  })

/**
 * Takes a namespaced cursor and serializes it into a base64 encoded
 * string.
 *
 * @private
 */
function serializeCursor ({ orderingName, cursor }: NamespacedCursor<any>): string {
  return new Buffer(JSON.stringify([orderingName, cursor])).toString('base64')
}

/**
 * Deserializes a base64 encoded namespace cursor into the correct data type.
 *
 * @private
 */
function deserializeCursor (serializedCursor: string): NamespacedCursor<any> {
  const [orderingName, cursor] = JSON.parse(new Buffer(serializedCursor, 'base64').toString())
  return { orderingName, cursor }
}

/**
 * The page info type contains information about the current page of results
 * returned by the connection.
 *
 * @private
 */
export const _pageInfoType: GraphQLObjectType<Connection<mixed, Paginator.Ordering, mixed>> =
  new GraphQLObjectType<Connection<mixed, Paginator.Ordering, mixed>>({
    name: 'PageInfo',
    // TODO: description
    fields: {
      hasNextPage: {
        type: new GraphQLNonNull(GraphQLBoolean),
        resolve: ({ page }) => page.hasNextPage(),
        // TODO: description
      },
      hasPreviousPage: {
        type: new GraphQLNonNull(GraphQLBoolean),
        resolve: ({ page }) => page.hasPreviousPage(),
        // TODO: description
      },
      startCursor: {
        type: _cursorType,
        resolve: ({ ordering, page }): NamespacedCursor<any> => ({
          orderingName: ordering ? ordering.name : null,
          cursor: page.values[0].cursor,
        }),
        // TODO: description
      },
      endCursor: {
        type: _cursorType,
        resolve: ({ ordering, page }): NamespacedCursor<any> => ({
          orderingName: ordering ? ordering.name : null,
          cursor: page.values[page.values.length - 1].cursor,
        }),
        // TODO: description
      },
    },
  })

/**
 * This is the type for the value of all connection types. It contains the
 * paginator for identification, ordering for cursor serialization, condition
 * for fetching the correct count, and of course the actual page of data.
 *
 * @private
 */
interface Connection<TValue, TOrdering extends Paginator.Ordering, TCursor> {
  paginator: Paginator<TValue, TOrdering, TCursor>
  ordering: Paginator.Ordering | undefined
  condition: Condition
  page: Paginator.Page<TValue, TCursor>
}

/**
 * This is the type for the value of all edge types. Similarly to the
 * connection value it has a paginator for identification, ordering for cursor
 * serialization, and of course a value and its associated cursor.
 *
 * @private
 */
interface Edge<TValue, TOrdering extends Paginator.Ordering, TCursor> {
  paginator: Paginator<TValue, TOrdering, TCursor>
  ordering: Paginator.Ordering | undefined
  cursor: TCursor
  value: TValue
}

/**
 * A namespaced cursor is a cursor with identifying information. A cursor that
 * was returned by one paginator can not be used by another paginator and a
 * cursor created with one ordering can not be used with another ordering.
 * Therefore we need to serialize this information with our cursor to make the
 * appropriate checks and ensure the cursor is valid for our resolve context.
 *
 * @private
 */
type NamespacedCursor<TCursor> = {
  // TODO: Evaluate if we really want to enforce paginator name checks.
  // paginatorName: string,
  orderingName: string | null,
  cursor: TCursor,
}