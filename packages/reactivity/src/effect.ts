import { isArray, isIntegerKey, isObject } from '@my-vue/shared'
import { Dep } from './dep'
import { TriggerOpTypes } from './operations'
import { ComputedRefImpl } from './computed'

type KeyToDepMap = Map<any, Set<ReactiveEffect>>

export type EffectScheduler = (...args: any[]) => any

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  scheduler?: EffectScheduler
}

const targetMap = new WeakMap<any, KeyToDepMap>()

export let activeEffect: ReactiveEffect | undefined
export let shouldTrack = true
export const ITERATE_KEY = Symbol('iterate')

export function pauseTracking() {
  shouldTrack = false
}

export function resetTracking() {
  shouldTrack = true
}

export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}

export class ReactiveEffect<T = any> {
  active = true
  deps: Dep[] = []
  parent : ReactiveEffect | undefined = undefined
  computed?: ComputedRefImpl<T>
  private deferStop = false

  // 通过外部注册一个停止时的回调，在 stop 方法调用时候调用
  onStop?: () => void

  constructor(
    public fn: () => T,
    public scheduler: EffectScheduler | null = null,
  ) {}

  run() {
    if (!this.active) return this.fn()

    try {
      this.parent = activeEffect
      activeEffect = this
      shouldTrack = true
      cleanupEffect(this)
      return this.fn()
    } finally {
      activeEffect = this.parent
      this.parent = undefined
      if (this.deferStop) {
        this.stop()
        this.deferStop = false
      }
    }
  }

  stop() {
    if (activeEffect === this) {
      this.deferStop = true
    } else {
      cleanupEffect(this)
      if (this.onStop) this.onStop()
      this.active = false
    }
  }
}

export function track(target: object, key: unknown) {
  if (shouldTrack && activeEffect) {
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = new Set()))
    }
    trackEffects(dep)
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key: unknown,
  newValue?: unknown,
  oldValue?: unknown
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return

  const deps: (Dep | undefined)[] = []
  deps.push(depsMap.get(key))

  // 数组长度减少
  if (isArray(target) && key === 'length') {
    for(let i = (newValue as number); i < (oldValue as number); i++) {
      deps.push(depsMap.get((i - 1) + ''))
    }
  }

  if (type === TriggerOpTypes.ADD) {
    if (isArray(target) && isIntegerKey(key)) {
      deps.push(depsMap.get('length'))
    } else if (isObject(target)) {
      deps.push(depsMap.get(ITERATE_KEY))
    }
  }

  // 遍历添加并去重
  const dep: Dep = new Set()
  deps.forEach(_dep => {
    if (!_dep) return
    _dep.forEach(v => dep.add(v))
  })
  
  triggerEffects(dep)
}

export function trackEffects(dep: Dep) {
  if (activeEffect) {
    dep.add(activeEffect)
    activeEffect.deps.push(dep)
  }
} 

export function triggerEffects(dep: Dep) {
  // 转换为数组，在遍历时会固定长度
  // 否则使用 Set 在遍历过程中如新加元素，会导致无限循环
  const effects = [...dep]

  // 计算属性所属的 ReactiveEffect 先执行产生计算属性的最新结果
  for(let i = 0; i < effects.length; i++) {
    if (effects[i].computed) {
      triggerEffect(effects[i])
    }
  }
  for(let i = 0; i < effects.length; i++) {
    if (!effects[i].computed) {
      triggerEffect(effects[i])
    }
  }
}

export function triggerEffect(effect: ReactiveEffect) {
  if (activeEffect !== effect) {
    if (effect.scheduler) {
      effect.scheduler()
    } else {
      effect.run()
    }
  }
}

export function effect(fn: () => any, options?: ReactiveEffectOptions) {
  const _effect = (fn as ReactiveEffectRunner).effect || new ReactiveEffect(fn, options?.scheduler)

  if (!options || !options.lazy) {
    _effect.run()
  }

  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  runner.effect = _effect
  return runner
}

function cleanupEffect(effect: ReactiveEffect) {
  const { deps } = effect

  deps.forEach(dep => {
    dep.delete(effect)
  })

  deps.length = 0
}