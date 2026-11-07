/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific locale governing permissions and
 * limitations under the License.
 */

import i18n from '../../i18n'

export function getOptions (locale: string) {
  return [
    {
      key: 'candle.priceMark.last.show',
      text: i18n('last_price_show', locale),
      component: 'switch'
    },
    {
      key: 'candle.priceMark.high.show',
      text: i18n('high_price_show', locale),
      component: 'switch'
    },
    {
      key: 'candle.priceMark.low.show',
      text: i18n('low_price_show', locale),
      component: 'switch'
    },
    {
      key: 'indicator.lastValueMark.show',
      text: i18n('indicator_last_value_show', locale),
      component: 'switch'
    },
    {
      // Chart-wide line smoothing (vendor styles root key): shapes the price
      // line family and indicator/compare lines; steps and drawings stay sharp.
      key: 'smoothness',
      text: i18n('smoothness', locale),
      component: 'select',
      dataSource: [
        { key: 'off', text: i18n('off', locale) },
        { key: 'low', text: i18n('low', locale) },
        { key: 'medium', text: i18n('medium', locale) },
        { key: 'high', text: i18n('high', locale) }
      ],
    },
    {
      key: 'yAxis.type',
      text: i18n('price_axis_type', locale),
      component: 'select',
      dataSource: [
        { key: 'normal', text: i18n('normal', locale) },
        { key: 'percentage', text: i18n('percentage', locale) },
        { key: 'log', text: i18n('log', locale) }
      ],
    },
    {
      key: 'yAxis.reverse',
      text: i18n('reverse_coordinate', locale),
      component: 'switch',
    },
    {
      key: 'grid.show',
      text: i18n('grid_show', locale),
      component: 'switch',
    }
  ]
}
