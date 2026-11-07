/**
 * First-party exchange datafeeds. Each venue implements the library's
 * `Datafeed` interface (see ../types.ts): paged history + live subscription,
 * plus the optional discovery methods (config/searchSymbols/resolveSymbol).
 * To add an exchange: one file, one class, pure parser functions exported for
 * fixture tests, then export it here.
 */
export { HyperliquidDatafeed, toHlInterval, parseCandleSnapshot, parseHlTrade, hlSubscription, parseHlUniverse, hlPricePrecision, HL_EXCHANGE, HL_INTERVAL_PERIODS, HL_CANDLE_PERIODS, type HlMetaAsset } from './hyperliquid'
export { BinanceDatafeed, toBinanceInterval, toBinanceSymbol, parseKlines, parseAggTrades, parseTradeMessage, binanceStreamName, parseExchangeInfo, precisionFromStep, BINANCE_EXCHANGE, BINANCE_INTERVAL_PERIODS, type BinanceMarket, type BinanceSymbolMeta } from './binance'
export { createCompositeDatafeed, type CompositeRoute } from './composite'
export { createAggregatingDatafeed, type AggregatingDatafeed, type AggregatingDatafeedOptions } from './aggregate'
export { SECOND_PERIOD, isSecondPeriod, secondBucket, TradeBarBuilder, barsFromTrades, type TradeTick } from './tradeBars'
