import Type from './Type'
import NamedType from './NamedType'

/**
 * A nullable type is an unnamed wrapper around any other type that signifies
 * the value may be null *or* the wrapped type’s value. Similar to the monad
 * `Maybe` in Haskell, or `Option` in Rust.
 *
 * Why did we choose to default to non-nullable when the two original
 * technologies (PostgreSQL and GraphQL) have every type as nullable by
 * default?
 *
 * 1. Non-nullable makes sense. It’s hard to remember that the domain of every
 *    type includes `null`. However, if we specify that a type’s domain *must*
 *    include `null` through this nullable type, our programs are easier to
 *    think about.
 * 2. It’s easier to statically type. With Typescript we can easily *add* types
 *    with a union, but we can’t take away a type. It would also be a pain to
 *    add `| null` to every `TValue`. Note that we are looking at this problem
 *    from the perspective of `strictNullTypes` on. Without `strictNullTypes`
 *    this choice doesn’t matter.
 * 3. Matches functional programming patterns. As mentioned before, this is a
 *    ubiquitous pattern in functional programming languages.
 *
 * Given the problem space of PostgreSQL and GraphQL it makes sense they would
 * default to all types being nullable, however given the problem space of our
 * interface, it makes more sense to be non-nullable by default then wrap types
 * with an instance of this type.
 *
 * Also note that it is possible that a nullable type could wrap another
 * nullable type. This may lead to unexpected behavior.
 */
class NullableType<
  TNonNullValue,
  TValue extends (TNonNullValue | null | undefined),
  TNonNullType extends Type<TNonNullValue>,
> extends Type<TValue> {
  constructor (
    private _nonNullType: Type<TNonNullType>,
  ) {
    super()
  }

  /**
   * Gets the base type for this nullable type.
   */
  public getNonNullType (): Type<TNonNullType> {
    return this._nonNullType
  }

  /**
   * Returns the base type.
   */
  public getNamedType (): NamedType<mixed> {
    return this._nonNullType.getNamedType()
  }
}

export default NullableType