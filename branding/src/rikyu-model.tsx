import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

export function Model({ src, label = '', className, style, view }: { src: string; label?: string; className?: string; style?: React.CSSProperties; view?: { position: [number,number,number]; target: [number,number,number]; fov: number } }) {
  const host = useRef<HTMLDivElement>(null)
  const viewJSON = JSON.stringify(view ?? null)
  useEffect(() => {
    if (!host.current || !src || src.startsWith('{')) return
    const container = host.current
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 3))
    const light = new THREE.DirectionalLight(0xffffff, 3)
    light.position.set(3, 5, 4)
    scene.add(light)
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000)
    const controller = new AbortController()
    let disposed = false
    const release = (root: THREE.Object3D) => root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) {
          if (typeof ImageBitmap !== 'undefined' && value.image instanceof ImageBitmap) value.image.close()
          value.dispose()
        }
        material.dispose()
      }
    })
    const draw = () => renderer.render(scene, camera)
    const resize = () => {
      const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1)
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const manager = new THREE.LoadingManager()
    manager.setURLModifier(url => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url
      throw new Error('External model dependencies are not supported')
    })
    fetch(src, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Model unavailable')
      return response.arrayBuffer()
    }).then(bytes => new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '')).then(gltf => {
      if (disposed) { release(gltf.scene); return }
      const bounds = new THREE.Box3().setFromObject(gltf.scene)
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const group = new THREE.Group()
      const scale = 2 / Math.max(size.x, size.y, size.z, 0.01)
      group.add(gltf.scene)
      group.scale.setScalar(scale)
      group.position.copy(center).multiplyScalar(-scale)
      scene.add(group)
      const distance = 4.6
      const view = JSON.parse(viewJSON)
      camera.position.set(distance * 0.65, distance * 0.35, distance)
      camera.lookAt(0, 0, 0)
      if (view && [...view.position, ...view.target, view.fov].every(Number.isFinite)) {
        camera.position.fromArray(view.position)
        camera.lookAt(new THREE.Vector3().fromArray(view.target))
        camera.fov = Math.max(10, Math.min(100, view.fov))
      }
      camera.far = distance * 100
      camera.updateProjectionMatrix()
      resize()
      container.setAttribute('data-model-state', 'ready')
    }).catch(() => { if (!disposed) container.setAttribute('data-model-error', 'true') })
    resize()
    return () => {
      disposed = true
      controller.abort()
      observer.disconnect()
      release(scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [src, viewJSON])
  return <div ref={host} data-model-state="loading" role="img" aria-label={label} className={className} style={{ width: '100%', height: 320, ...style }} />
}
