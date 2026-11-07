/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const stroke = (d: string) => () => (
  <svg class="icon-overlay" viewBox="0 0 22 22">
    <path d={d} fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
)

export const infoLine = stroke('M4 17L12 9M13.5 12.5H19.5V17.5H13.5ZM4 17h.01M12 9h.01')
export const longPosition = stroke('M4 4H18V18H4ZM4 13H18M11 10.5V6M9 8L11 6L13 8')
export const shortPosition = stroke('M4 4H18V18H4ZM4 9H18M11 11.5V16M9 14L11 16L13 14')
export const priceRange = stroke('M5 4H17M5 18H17M11 17V5M9 7L11 5L13 7')
export const dateRange = stroke('M4 5V17M18 5V17M5 11H17M15 9L17 11L15 13')
export const datePriceRange = stroke('M4 4H18V18H4ZM11 16V6M9 8L11 6L13 8M6 11H16M14 9L16 11L14 13')
export const measure = stroke('M3 15L15 3L19 7L7 19ZM6 12L8 14M9 9L11 11M12 6L14 8')
export const text = stroke('M5 5H17M11 5V18M8.5 18H13.5')
export const note = stroke('M11 12V19M11 12A4 4 0 1 0 11 4A4 4 0 1 0 11 12')
export const callout = stroke('M5 4H17A2 2 0 0 1 19 6V12A2 2 0 0 1 17 14H11L6 18.5V14H5A2 2 0 0 1 3 12V6A2 2 0 0 1 5 4Z')
export const priceLabel = stroke('M3 7H14L19 11L14 15H3ZM6 11H11')
export const brush = stroke('M4 18C6.5 18 7.5 16.5 8.5 14.5L16 6L18 8L10 15.5C8.5 17 6.5 18 4 18ZM14.5 7.5L16.5 9.5')
export const highlighter = stroke('M7 15L14 4L18 6.5L11 17.5ZM7 15L6 18H9.5L11 17.5M4 20H12')
export const anchoredVwap = stroke('M3 16C6 15 7 9 10 10S14 16 19 5M3 18H19M5 16V18M9 11V18M13 14V18M17 8V18')
export const fixedRangeVolumeProfile = stroke('M4 4V18M4 6H15M4 9H19M4 12H12M4 15H17')
export const regressionChannel = stroke('M3 17L19 7M3 13L19 3M3 21L19 11')
export const polyline = stroke('M3 17L8 7L13 14L19 4M3 17h.01M8 7h.01M13 14h.01M19 4h.01')
export const path = stroke('M3 16C6 5 10 5 12 12S17 19 20 6')
export const ellipse = stroke('M3 11A8 5 0 1 0 19 11A8 5 0 1 0 3 11')
export const fibonacciChannel = stroke('M3 17L14 6M6 19L17 8M9 20L20 9M6 13L10 17')
export const fibonacciTimeZone = stroke('M4 4V18M8 4V18M14 4V18M20 4V18M3 16H21')
export const headAndShoulders = stroke('M2 16L5 9L8 14L11 4L14 14L17 9L20 16M3 16H19')
export const trianglePattern = stroke('M3 5L19 11L3 17L15 12L3 5')
export const threeDrives = stroke('M2 17L5 7L8 14L11 5L14 12L18 3L20 10')
export const barsPattern = stroke('M3 17L6 12L9 14L12 6M12 17L15 12L18 14L21 6')
