
import test from 'zopf'
import clone from 'clone'
import deep from 'deep-diff'

import {indexBy} from 'underline'

import patch from '../../app/util/patch'

test('patch', t => {
  const state = [ {id: 42}, {id: 21}, {id: 8} ]::indexBy('id')
  let saved_state = {}
  let patched_state = {}

  const send_diff = (label) => {
    const diff = deep.diff(saved_state, state)
    saved_state = clone(state)
    patched_state = patch(patched_state, diff)
    t.same(patched_state, state, label)
  }

  send_diff('initial')

  state['42'].name = 'Hi!'
  send_diff('add field')

  state['42'].name = 'Bye!'
  send_diff('change field')

  delete state['42'].name
  send_diff('delete field')

  delete state['21']
  send_diff('delete record')
})

test('patchAt', t => {
  let state = {
    library: {
      games: {}
    }
  }

  const diff = [
    {
      kind: 'N',
      path: ['dashboard', '50723'],
      rhs: {
        name: 'Nono'
      }
    },
    {
      kind: 'N',
      path: ['dashboard', '50724'],
      rhs: {
        name: 'Momo'
      }
    }
  ]
  state = patch.applyAt(state, ['library', 'games'], diff)

  t.same(state, {
    library: {
      games: {
        dashboard: {
          '50723': {name: 'Nono'},
          '50724': {name: 'Momo'}
        }
      }
    }
  })
})
