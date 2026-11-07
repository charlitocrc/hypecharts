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

const fork = (lines: string) => () => (
  <svg class="icon-overlay" viewBox="0 0 22 22">
    <path d={`${lines}M8 9L13 14`} fill="none" stroke-linecap="round"/>
    <circle cx="4" cy="18" r="1.5" stroke="none"/>
    <circle cx="8" cy="9" r="1.5" stroke="none"/>
    <circle cx="13" cy="14" r="1.5" stroke="none"/>
  </svg>
)

export const pitchfork = fork('M4 18L17 5M8 9L14 3M13 14L19 8')
export const schiffPitchfork = fork('M4 18L8 9M4 13.5L17 9.5M8 9L16.5 6.4M13 14L19 12.2')
export const modifiedSchiffPitchfork = fork('M4 18L8 9M6 13.5L17 8.6M8 9L17 5M13 14L19 11.3')
export const insidePitchfork = fork('M4 18L8 9M10.5 11.5L18.5 12.1M8 9L19 9.8M13 14L19 14.4')
