import { asMaybe, asObject, asString } from 'cleaners'

import { FilledTextInputBaseProps } from '../components/themed/FilledTextInput'

// Define all form field types here.
export type FormFieldType =
  | 'address'
  | 'address2'
  | 'text'
  | 'postalcode'
  | 'state'
  | 'city'
  | 'name'
  | 'iban'
  | 'swift'

// For each form field type, define the relevant display properties that will be
// used to pass along to the FilledTextInput.
export const FORM_FIELD_DISPLAY_PROPS: {
  readonly [fieldType in FormFieldType]: {
    widthRem?: number
    textInputProps?: Partial<FilledTextInputBaseProps>
  }
} = {
  address: {
    widthRem: undefined,
    textInputProps: undefined
  },
  address2: {
    widthRem: undefined,
    textInputProps: undefined
  },
  city: {
    // TODO: Extend component to also render dropdowns
    widthRem: undefined,
    textInputProps: undefined
  },
  iban: {
    widthRem: 20,
    textInputProps: undefined
  },
  name: {
    widthRem: undefined,
    textInputProps: undefined
  },
  state: {
    // TODO: Extend component to also render dropdowns
    widthRem: undefined,
    textInputProps: undefined
  },
  swift: {
    widthRem: 13,
    textInputProps: undefined
  },
  postalcode: {
    // Global postal codes can include letters and symbols
    // TODO: Character input filtering props for weird cases like this where
    // default keyboard types may include some disallowed characters.
    widthRem: 13
  },
  text: {
    widthRem: undefined,
    textInputProps: undefined
  }
}

export const SEPA_FORM_DISKLET_NAME = 'sepaInfo.json'

export const asSepaInfo = asObject({
  name: asString,
  iban: asString,
  swift: asString
})

export type SepaInfo = ReturnType<typeof asSepaInfo>

export const ADDRESS_FORM_DISKLET_NAME = 'homeAddress.json'
export const EMAIL_CONTACT_FORM_DISKLET_NAME = 'emailContactInfo.json'

export const asEmailContactInfo = asObject({
  email: asString,
  firstName: asString,
  lastName: asString
})

export type EmailContactInfo = ReturnType<typeof asEmailContactInfo>

export const asHomeAddress = asObject({
  address: asString,
  address2: asMaybe(asString),
  city: asString,
  country: asString,
  state: asString,
  postalCode: asString
})

export type HomeAddress = ReturnType<typeof asHomeAddress>
