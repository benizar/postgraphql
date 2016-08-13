import Type from './Type'
import NamedType from './NamedType'

/**
 * An alias type is a very simple wrapper around a named type. The point of
 * an alias type is to just give a type another name. So for example if we want
 * a custom string type for emails we would create an alias type like:
 *
 * ```js
 * new AliasType('email', stringType)
 * ```
 *
 * The reason we only alias named types is that it is easier to work with in
 * services that don’t support type aliasing. Like in GraphQL which doesn’t
 * support aliasing unnamed types.
 */
class AliasType<TValue, TType extends Type<TValue>> extends NamedType<TValue> {
  constructor (
    name: string,
    private _baseType: TType,
  ) {
    super(name)
  }

  /**
   * Proxies the base type’s `isTypeOf` function.
   */
  public isTypeOf (value: any): value is TValue {
    return this._baseType.isTypeOf(value)
  }

  /**
   * Returns the base type for this alias type.
   */
  public getBaseType (): TType {
    return this._baseType
  }
}

export default AliasType