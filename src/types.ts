export type Bindings = {
  DB: D1Database
  WEBHOOK_SECRET: string
  FORWARD_WEBHOOK_URL?: string
  ENVIRONMENT?: string
}

export type PaymentPayload = {
  id: number
  bank: string
  amount_bs: number
  raw_amount: string
  phone_number: string
  phone_prefix?: string | null
  phone_last_digits?: string | null
  reference?: string | null
  date: string
  time?: string | null
  raw_title: string
  raw_body: string
  received_at: number
}

export type VerifyRequest = {
  referencia?: string
  telefonoUltimos4?: string
  montoEsperado: number
  fecha?: string
}

export type PagoEntity = {
  id: number
  bank: string
  amount_bs: number
  raw_amount: string
  phone_number: string
  phone_prefix: string | null
  phone_last_digits: string | null
  reference: string | null
  date: string
  time: string | null
  raw_title: string | null
  raw_body: string | null
  received_at: number
  used: number
  used_at: string | null
  created_at: string
}
