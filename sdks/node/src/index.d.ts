// Types for @firstflip/node — mirror openapi.yaml (components.schemas).

export type ChargeStatus = 'pending' | 'paid' | 'expired' | 'cancelled';
export type Currency = 'NGN' | 'USD';
export type PayAsset = 'USDT' | 'USDC' | 'BTC';
export type PayNetwork = 'trc20' | 'bep20' | 'bitcoin';
export type EventType = 'charge.paid' | 'charge.cancelled' | 'charge.expired';

export interface Account {
  object: 'account';
  business_name: string | null;
  livemode: boolean;
  key: string;
}

export interface Charge {
  id: string;
  object: 'charge';
  livemode: boolean;
  status: ChargeStatus;
  amount: number;
  currency: Currency;
  description: string | null;
  reference: string | null;
  metadata: Record<string, string>;
  customer: { name: string | null; email: string | null };
  payment: {
    asset: PayAsset;
    network: PayNetwork;
    address: string;
    asset_amount: number;
    fee_asset_amount: number;
    rate_locked_until: string;
  };
  hosted_url: string;
  payment_link: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
}

export interface ChargeCreateParams {
  amount: number;
  currency: Currency;
  pay_asset?: PayAsset;
  pay_network?: PayNetwork;
  description?: string;
  reference?: string;
  expires_in_minutes?: number;
  customer?: { name?: string; email?: string };
  metadata?: Record<string, string | number | boolean>;
}

export interface ChargeListParams {
  limit?: number;
  starting_after?: string;
  status?: ChargeStatus;
  reference?: string;
  created_from?: string;
  created_before?: string;
}

export interface PaymentLink {
  id: string;
  object: 'payment_link';
  livemode: boolean;
  active: boolean;
  url: string;
  amount: number;
  currency: Currency;
  description: string | null;
  pay_asset: PayAsset;
  pay_network: PayNetwork;
  metadata: Record<string, string>;
  max_uses: number | null;
  uses: number;
  created_at: string;
}

export interface PaymentLinkCreateParams {
  amount: number;
  currency: Currency;
  pay_asset?: PayAsset;
  pay_network?: PayNetwork;
  description?: string;
  max_uses?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface PaymentLinkListParams {
  limit?: number;
  starting_after?: string;
  active?: boolean;
  created_from?: string;
  created_before?: string;
}

export type SubAccountStatus = 'active' | 'suspended';

export interface SubAccount {
  id: string;
  object: 'subaccount';
  livemode: boolean;
  reference: string;
  name: string;
  email: string | null;
  status: SubAccountStatus;
  tier: number;
  metadata: Record<string, string>;
  sandbox: { wallet_provisioned: false; accepts_real_money: false };
  created_at: string;
  updated_at: string;
}

export interface SubAccountCreateParams {
  name: string;
  email?: string;
  reference?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SubAccountListParams {
  limit?: number;
  starting_after?: string;
  status?: SubAccountStatus;
  reference?: string;
  created_from?: string;
  created_before?: string;
}

export type TransferStatus = 'new' | 'pending' | 'successful' | 'failed';
export type TransferType = 'international_bank' | 'bank_account' | 'mobile_money' | 'stablecoin' | 'stablecoin_funding';

export interface Transfer {
  id: string;
  object: 'transfer';
  livemode: false;
  reference: string;
  status: TransferStatus;
  type: TransferType;
  country: string | null;
  network: string | null;
  currency: string;
  debit_currency: string;
  amount: number;
  beneficiary: { account_last4: string };
  fee: null;
  fee_currency: string;
  sandbox: { funds_sent: false; fee_quoted: false };
  created_at: string;
}

export interface TransferListParams {
  limit?: number;
  starting_after?: string;
  status?: TransferStatus;
  batch_id?: string;
  created_from?: string;
  created_before?: string;
}

export interface TransferBeneficiary {
  routing_number?: string;
  swift_code?: string;
  bank_name?: string;
  account_type?: string;
  beneficiary_address?: string;
  recipient_address?: string;
  postal_code?: string;
  street_number?: string;
  street_name?: string;
  city?: string;
  first_name?: string;
  last_name?: string;
  beneficiary_merchant_name?: string;
  email?: string;
  mobile_number?: string;
  sender_address?: string;
  sender_mobile_number?: string;
}

export interface TransferCreateParams {
  amount: number | string;
  currency: string;
  type?: TransferType;
  debit_currency?: string;
  country?: string;
  account_bank?: string;
  account_number?: string;
  network?: 'SOLANA' | 'ETHEREUM' | 'BASE' | 'POLYGON';
  beneficiary_name?: string;
  beneficiary?: TransferBeneficiary;
  destination_branch_code?: string;
  reference?: string;
  narration?: string;
}

export interface TransferBatch {
  id: string;
  object: 'transfer_batch';
  livemode: false;
  status: 'processing' | 'completed';
  count: number;
  data: Transfer[];
}

export type FxCurrency = 'NGN' | 'GHS' | 'USD';
export type FxQuoteStatus = 'processing' | 'ready' | 'expired' | 'failed' | 'used';
export type FxScenario = 'ready' | 'processing' | 'expired' | 'invalid_amount' | 'invalid_currency_pair' | 'exceeded_limit';
export type FxQuoteSimulation = 'ready' | 'failed' | 'expired';

export interface FxQuote {
  id: string;
  object: 'fx_quote';
  livemode: false;
  status: FxQuoteStatus;
  reference: string | null;
  base_currency: FxCurrency;
  target_currency: FxCurrency;
  quantity: number;
  quote: { rate: string; approved_quantity: number; total_value: number; expires_at: string } | null;
  failure_code: string | null;
  pricing: { fee: number; currency: string; status: 'simulated' };
  sandbox: { synthetic_rate: true };
  created_at: string;
}

export interface FxQuoteCreateParams {
  base_currency: FxCurrency;
  target_currency: FxCurrency;
  quantity: number;
  reference?: string;
  // Test-mode outcome for the quote itself; default 'ready'.
  scenario?: FxScenario;
}

export type FxTradeStatus = 'new' | 'pending' | 'settled' | 'failed';
export type FxTradeSimulation = 'pending' | 'settled' | 'failed';

export interface FxTrade {
  id: string;
  object: 'fx_trade';
  livemode: false;
  quote_id: string;
  status: FxTradeStatus;
  base_currency: FxCurrency;
  target_currency: FxCurrency;
  quantity: number;
  approved_quantity: number;
  price: number;
  narration: string | null;
  created_at: string;
}

export interface FxTradeCreateParams {
  quote_id: string;
  narration?: string;
}

export type VirtualAccountCurrency = 'NGN' | 'GHS';
export type VirtualAccountType = 'dynamic' | 'static';
export type VirtualAccountStatus = 'active' | 'inactive' | 'expired' | 'used';

export interface VirtualAccountCustomer {
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  bvn?: string;
  nin?: string;
  bvn_verification_id?: string;
}

export interface VirtualAccount {
  id: string;
  object: 'virtual_account';
  livemode: false;
  reference: string;
  currency: VirtualAccountCurrency;
  type: VirtualAccountType;
  status: VirtualAccountStatus;
  amount: number | null;
  account_number: string;
  bank_name: 'FirstFlip Sandbox Bank';
  narration: string | null;
  expires_at: string | null;
  created_at: string;
  sandbox: { accepts_real_transfers: false };
}

export interface VirtualAccountCreateParams {
  customer: VirtualAccountCustomer;
  currency?: VirtualAccountCurrency;
  type?: VirtualAccountType;
  amount?: number;
  reference?: string;
  narration?: string;
  expires_in?: number;
}

export interface VirtualAccountBatch {
  id: string;
  object: 'virtual_account_batch';
  livemode: false;
  status: 'processing' | 'completed';
  currency?: VirtualAccountCurrency;
  count: number;
  data: VirtualAccount[];
}

export type VirtualAccountPaymentStatus = 'successful' | 'failed' | 'reversed';

export interface VirtualAccountPayment {
  id: string;
  object: 'virtual_account_payment';
  livemode: false;
  virtual_account_id: string;
  reference: string;
  session_id: string;
  currency: VirtualAccountCurrency;
  amount: number;
  credited_amount: number;
  reversed_amount: number;
  status: VirtualAccountPaymentStatus;
  sandbox: { wallet_credited: false };
  created_at: string;
}

// NGN: equal to the account amount succeeds, less reverses, more credits the amount and reverses the excess.
// GHS: anything but the exact amount fails.
export interface VirtualAccountPaymentParams {
  amount: number;
  reference: string;
}

export type BvnStatus = 'consent_pending' | 'verified' | 'declined' | 'failed';
export type BvnOutcome = 'verified' | 'declined' | 'failed';

export interface BvnVerification {
  id: string;
  object: 'bvn_verification';
  livemode: false;
  purpose: 'api_customer' | 'api_owner';
  status: BvnStatus;
  consent_granted: boolean;
  verified_at: string | null;
  expires_at: string;
  consent_url?: null; // present (null) on create only; the sandbox never invents a hosted consent URL
  sandbox: { identity_verified: false; consent_channel: 'email' };
}

export interface BvnCreateParams {
  bvn: string;
  first_name: string;
  last_name: string;
  redirect_url: string;
}

export type ResolveBankType = 'bank_account' | 'mobile_money';

export interface ResolveBankParams {
  account_bank: string;
  account_number: string;
  country?: 'NG' | 'GH';
  type?: ResolveBankType;
}

export interface BankVerification {
  object: 'bank_account_verification';
  livemode: false;
  country: 'NG' | 'GH';
  type: ResolveBankType;
  account_bank: string;
  account_number: string;
  account_name: string;
  sandbox: { account_verified: false };
}

export type OtpMedium = 'email' | 'sms' | 'whatsapp';
export type OtpStatus = 'pending' | 'verified' | 'expired' | 'locked';

export interface OtpPricing {
  object: 'otp_pricing';
  currency: 'NGN';
  data: Array<{ medium: OtpMedium; unit_amount: number }>;
}

export interface Otp {
  id: string;
  object: 'otp';
  livemode: false;
  status: OtpStatus;
  medium: OtpMedium[];
  length: number;
  attempts_remaining: number;
  billing: { currency: 'NGN'; amount: number; status: 'simulated' };
  expires_at: string;
  verified_at: string | null;
  created_at: string;
  // create() only: the fixed sandbox code, which is also what validate() expects
  sandbox?: { code: string; delivered: false };
}

export interface OtpCreateParams {
  customer: { name: string; email?: string; phone?: string };
  medium?: OtpMedium[];
  length?: 5 | 6 | 7;
  expiry?: number;
  sender?: string;
  send?: true;
}

export interface AssistantAnswer {
  object: 'assistant_answer';
  answer: string;
  // Sentences the grounding guard dropped because the docs do not support them.
  removed_claims: number;
}

export type CardStatus = 'active' | 'frozen' | 'closed';
export type CardTransactionType = 'topup' | 'withdrawal' | 'authorization';
export type CardTransactionStatus = 'completed' | 'approved' | 'declined';
export type CardDeclineCode =
  | 'card_frozen'
  | 'over_per_transaction_limit'
  | 'over_daily_limit'
  | 'over_monthly_limit'
  // The only one that is not yours to set: FirstFlip's ceiling on what all your cards may spend in a
  // rolling 30 days. A top-up and a raised `limits` axis both fail to clear it.
  | 'over_tenant_monthly_limit'
  | 'insufficient_funds';

export interface CardLimits {
  daily: number | null;
  per_transaction: number | null;
  monthly: number | null;
}

export interface Card {
  id: string;
  object: 'card';
  livemode: false;
  reference: string;
  status: CardStatus;
  currency: 'USD';
  balance: number;
  number_last4: string;
  expiry_month: number;
  expiry_year: number;
  limits: CardLimits;
  frozen_reason?: string | null;
  closed_reason?: string | null;
  created_at: string;
  updated_at: string;
  sandbox: { real_card: false; funds_movable: false };
}

export interface CardTransaction {
  id: string;
  object: 'card_transaction';
  livemode: false;
  card_id: string;
  reference: string;
  type: CardTransactionType;
  status: CardTransactionStatus;
  currency: 'USD';
  amount: number;
  balance_before: number;
  balance_after: number;
  merchant?: string | null;
  decline_code?: CardDeclineCode | null;
  created_at: string;
  sandbox: { settled: false };
}

export interface CardCreateParams {
  // Validated, then not stored: no name or email is persisted on the card.
  customer: { email: string; first_name: string; last_name: string };
  currency?: 'USD';
  reference?: string;
  daily_limit?: number | null;
  per_transaction_limit?: number | null;
  monthly_limit?: number | null;
}

export interface CardListParams {
  limit?: number;
  starting_after?: string;
  created_from?: string;
  created_before?: string;
}

export interface CardTransactionListParams {
  limit?: number;
  starting_after?: string;
  created_from?: string;
  created_before?: string;
  type?: CardTransactionType;
  status?: CardTransactionStatus;
}

export interface CardAmountParams {
  amount: number;
}

export interface CardReasonParams {
  reason?: string;
}

// Omit an axis to leave it alone; send null to remove that ceiling. A partial update cannot unlimit what you forgot.
export interface CardLimitsParams {
  daily_limit?: number | null;
  per_transaction_limit?: number | null;
  monthly_limit?: number | null;
}

export interface CardAuthorizationParams {
  amount: number;
  merchant?: string;
}

export interface List<T> { object: 'list'; data: T[]; has_more: boolean }

export interface Event {
  id: string;
  object: 'event';
  type: EventType;
  livemode: boolean;
  created_at: string;
  data: { object: Charge };
}

export interface RequestOptions { idempotencyKey?: string }

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export interface VerifyOptions { toleranceSeconds?: number; now?: number }

export declare class FirstFlipError extends Error {
  status?: number;
  type: 'invalid_request_error' | 'authentication_error' | 'idempotency_error' | 'rate_limit_error' | 'api_error' | 'connection_error';
  code: string;
  param: string | null;
  headers: Record<string, string>;
}

export declare function verify(raw: string | Buffer, header: string | undefined, secret: string, options?: VerifyOptions): boolean;
export declare function constructEvent(raw: string | Buffer, header: string | undefined, secret: string, options?: VerifyOptions): Event;

export declare class FirstFlip {
  constructor(secretKey: string, options?: ClientOptions);
  readonly livemode: boolean;
  account: { retrieve(): Promise<Account> };
  charges: {
    create(params: ChargeCreateParams, options?: RequestOptions): Promise<Charge>;
    retrieve(id: string): Promise<Charge>;
    list(params?: ChargeListParams): Promise<List<Charge>>;
    listAll(params?: Omit<ChargeListParams, 'starting_after'>): AsyncGenerator<Charge>;
    cancel(id: string, options?: RequestOptions): Promise<Charge>;
    simulatePayment(id: string, options?: RequestOptions): Promise<Charge>;
  };
  paymentLinks: {
    create(params: PaymentLinkCreateParams, options?: RequestOptions): Promise<PaymentLink>;
    retrieve(id: string): Promise<PaymentLink>;
    list(params?: PaymentLinkListParams): Promise<List<PaymentLink>>;
    listAll(params?: Omit<PaymentLinkListParams, 'starting_after'>): AsyncGenerator<PaymentLink>;
    deactivate(id: string, options?: RequestOptions): Promise<PaymentLink>;
  };
  subaccounts: {
    create(params: SubAccountCreateParams, options?: RequestOptions): Promise<SubAccount>;
    retrieve(id: string): Promise<SubAccount>;
    list(params?: SubAccountListParams): Promise<List<SubAccount>>;
    listAll(params?: Omit<SubAccountListParams, 'starting_after'>): AsyncGenerator<SubAccount>;
    suspend(id: string, options?: RequestOptions): Promise<SubAccount>;
    activate(id: string, options?: RequestOptions): Promise<SubAccount>;
  };
  transfers: {
    create(params: TransferCreateParams, options?: RequestOptions): Promise<Transfer>;
    retrieve(id: string): Promise<Transfer>;
    list(params?: TransferListParams): Promise<List<Transfer>>;
    listAll(params?: Omit<TransferListParams, 'starting_after'>): AsyncGenerator<Transfer>;
    simulate(id: string, status: Exclude<TransferStatus, 'new'>, options?: RequestOptions): Promise<Transfer>;
    createBatch(transfers: Omit<TransferCreateParams, 'reference'>[], options?: RequestOptions): Promise<TransferBatch>;
    retrieveBatch(id: string): Promise<TransferBatch>;
  };
  fx: {
    createQuote(params: FxQuoteCreateParams, options?: RequestOptions): Promise<FxQuote>;
    retrieveQuote(id: string): Promise<FxQuote>;
    simulateQuote(id: string, status: FxQuoteSimulation, options?: RequestOptions): Promise<FxQuote>;
    createTrade(params: FxTradeCreateParams, options?: RequestOptions): Promise<FxTrade>;
    retrieveTrade(id: string): Promise<FxTrade>;
    simulateTrade(id: string, status: FxTradeSimulation, options?: RequestOptions): Promise<FxTrade>;
  };
  virtualAccounts: {
    create(params: VirtualAccountCreateParams, options?: RequestOptions): Promise<VirtualAccount>;
    retrieve(id: string): Promise<VirtualAccount>;
    createBatch(accounts: Omit<VirtualAccountCreateParams, 'reference' | 'expires_in'>[], options?: RequestOptions): Promise<VirtualAccountBatch>;
    retrieveBatch(id: string): Promise<VirtualAccountBatch>;
    deactivate(id: string, options?: RequestOptions): Promise<VirtualAccount>;
    simulatePayment(id: string, params: VirtualAccountPaymentParams, options?: RequestOptions): Promise<VirtualAccountPayment>;
  };
  verifications: {
    createBvn(params: BvnCreateParams, options?: RequestOptions): Promise<BvnVerification>;
    retrieveBvn(id: string): Promise<BvnVerification>;
    simulateBvn(id: string, outcome: BvnOutcome, options?: RequestOptions): Promise<BvnVerification>;
    resolveBank(params: ResolveBankParams, options?: RequestOptions): Promise<BankVerification>;
  };
  otps: {
    pricing(): Promise<OtpPricing>;
    create(params: OtpCreateParams, options?: RequestOptions): Promise<Otp>;
    retrieve(id: string): Promise<Otp>;
    validate(id: string, otp: string, options?: RequestOptions): Promise<Otp>;
  };
  assistant: {
    ask(question: string): Promise<AssistantAnswer>;
  };
  cards: {
    create(params: CardCreateParams, options?: RequestOptions): Promise<Card>;
    retrieve(id: string): Promise<Card>;
    list(params?: CardListParams): Promise<List<Card>>;
    listAll(params?: Omit<CardListParams, 'starting_after'>): AsyncGenerator<Card>;
    listTransactions(id: string, params?: CardTransactionListParams): Promise<List<CardTransaction>>;
    fund(id: string, params: CardAmountParams, options?: RequestOptions): Promise<Card>;
    withdraw(id: string, params: CardAmountParams, options?: RequestOptions): Promise<Card>;
    freeze(id: string, params?: CardReasonParams, options?: RequestOptions): Promise<Card>;
    unfreeze(id: string, options?: RequestOptions): Promise<Card>;
    close(id: string, params?: CardReasonParams, options?: RequestOptions): Promise<Card>;
    updateSpendLimits(id: string, params: CardLimitsParams, options?: RequestOptions): Promise<Card>;
    simulateAuthorization(id: string, params: CardAuthorizationParams, options?: RequestOptions): Promise<CardTransaction>;
  };
  webhooks: { verify: typeof verify; constructEvent: typeof constructEvent };
}

export declare const webhooks: { verify: typeof verify; constructEvent: typeof constructEvent };
export default FirstFlip;
