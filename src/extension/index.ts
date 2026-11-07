import arrow from './arrow'

import circle from './circle'
import rect from './rect'
import parallelogram from './parallelogram'
import triangle from './triangle'
import fibonacciCircle from './fibonacciCircle'
import fibonacciSegment, { fibonacciLine } from './fibonacciSegment'
import fibonacciSpiral from './fibonacciSpiral'
import fibonacciSpeedResistanceFan from './fibonacciSpeedResistanceFan'
import fibonacciExtension from './fibonacciExtension'
import gannBox from './gannBox'
import threeWaves from './threeWaves'
import fiveWaves from './fiveWaves'
import eightWaves from './eightWaves'
import anyWaves from './anyWaves'
import abcd from './abcd'
import xabcd from './xabcd'
import { pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork } from './pitchfork'
import { longPosition, shortPosition } from './position'
import { priceRange, dateRange, datePriceRange, measureTool, infoLine } from './measure'
import segment from './segment'
import { text, note, callout, priceLabel } from './annotation'
import { brush, highlighter } from './brush'
import advancedOverlays from './advanced'
import derivedOverlays from './derived'

const overlays = [
  arrow,
  longPosition, shortPosition,
  priceRange, dateRange, datePriceRange, measureTool, infoLine,
  text, note, callout, priceLabel,
  segment,
  brush, highlighter,
  pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork,
  circle, rect, triangle, parallelogram,
  fibonacciLine, fibonacciCircle, fibonacciSegment, fibonacciSpiral,
  fibonacciSpeedResistanceFan, fibonacciExtension, gannBox,
  threeWaves, fiveWaves, eightWaves, anyWaves, abcd, xabcd,
  ...advancedOverlays,
  ...derivedOverlays
]

export default overlays
