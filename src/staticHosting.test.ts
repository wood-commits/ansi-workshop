// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { build, createServer, resolveConfig, type ResolvedConfig } from 'vite'

let productionHtml: string
let developmentHtml: string
let config: ResolvedConfig

beforeAll(async () => {
  config = await resolveConfig({ logLevel: 'silent' }, 'build')
  const result = await build({ logLevel: 'silent', build: { write: false } })
  if (Array.isArray(result) || !('output' in result)) throw new Error('Expected a single browser build.')
  const html = result.output.find(output => output.type === 'asset' && output.fileName === 'index.html')
  if (!html || html.type !== 'asset' || typeof html.source !== 'string') throw new Error('Missing built HTML.')
  productionHtml = html.source

  const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true, watch: null } })
  try {
    const source = await readFile('index.html', 'utf8')
    developmentHtml = await server.transformIndexHtml('/', source)
  } finally {
    await server.close()
  }
}, 30_000)

describe('static hosting protections', () => {
  it('uses a local SVG favicon with a subdirectory-safe production URL', async () => {
    expect(productionHtml).toContain('<link rel="icon" type="image/svg+xml" href="./favicon.svg"')
    expect(developmentHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg"')
    const favicon = await readFile('public/favicon.svg', 'utf8')
    expect(favicon).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(favicon).toContain('viewBox="0 0 32 32"')
    expect(favicon).toContain('fill="#c4ee86"')
  })

  it('links a same-origin web app manifest whose icons install as the favicon brand mark', async () => {
    expect(productionHtml).toContain('<link rel="manifest" href="./manifest.webmanifest"')
    expect(productionHtml).toContain('<link rel="apple-touch-icon" href="./apple-touch-icon.png"')
    expect(developmentHtml).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(config.preview.headers?.['Content-Security-Policy']).toContain("manifest-src 'self';")
    const manifest: unknown = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'))
    expect(manifest).toMatchObject({ name: 'ANSI Workshop', start_url: './', scope: './', display: 'standalone' })
    const icons = (manifest as { icons: { src: string; sizes: string; type: string; purpose: string }[] }).icons
    expect(icons.map(icon => [icon.src, icon.sizes, icon.purpose])).toEqual([
      ['favicon.svg', 'any', 'any'], ['icon-192.png', '192x192', 'any'],
      ['icon-512.png', '512x512', 'any'], ['icon-maskable-512.png', '512x512', 'maskable'],
    ])
    const pngs = {
      'icon-192.png': await readFile('public/icon-192.png'),
      'icon-512.png': await readFile('public/icon-512.png'),
      'icon-maskable-512.png': await readFile('public/icon-maskable-512.png'),
      'apple-touch-icon.png': await readFile('public/apple-touch-icon.png'),
    }
    for (const icon of [...icons.filter(icon => icon.type === 'image/png'), { src: 'apple-touch-icon.png', sizes: '180x180' }]) {
      const png = Object.entries(pngs).find(([name]) => name === icon.src)?.[1]
      if (!png) throw new Error(`Unexpected manifest icon ${icon.src}`)
      expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const size = Number(icon.sizes.split('x')[0])
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
    }
  })

  it('emits the supported production CSP before scripts and styles', () => {
    const metas = [...productionHtml.matchAll(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/g)]
    expect(metas).toHaveLength(1)
    const meta = metas[0]
    const policy = meta[0].match(/\bcontent="([^"]*)"/)?.[1].replaceAll('&#39;', "'")
    const header = config.preview.headers?.['Content-Security-Policy']
    expect(typeof header).toBe('string')
    if (typeof header !== 'string') throw new Error('Missing production CSP header.')
    expect(policy).toBe(header.replace("; frame-ancestors 'none'", ''))
    expect(policy).not.toMatch(/frame-ancestors|report-uri|sandbox|ws:|unsafe-eval/)
    expect(policy).toContain("script-src 'self';")
    expect(meta.index).toBeGreaterThan(productionHtml.indexOf('<head>'))
    expect(meta.index).toBeLessThan(productionHtml.indexOf('</head>'))
    for (const resource of productionHtml.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      expect(meta.index).toBeLessThan(resource.index)
    }
    for (const resource of productionHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
      expect(resource[1]).toMatch(/^\.\//)
    }
  })

  it('preserves no-referrer HTML protection and the stronger local-server headers', () => {
    expect(productionHtml).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/)
    for (const headers of [config.server.headers, config.preview.headers]) {
      expect(headers?.['Content-Security-Policy']).toContain("frame-ancestors 'none'")
      expect(headers?.['X-Content-Type-Options']).toBe('nosniff')
      expect(headers?.['Referrer-Policy']).toBe('no-referrer')
      expect(headers?.['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
    }
  })

  it('does not impose the production meta policy on development refresh and HMR', () => {
    expect(developmentHtml).not.toContain('http-equiv="Content-Security-Policy"')
    expect(config.server.headers?.['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline'")
    expect(config.server.headers?.['Content-Security-Policy']).toContain('ws://127.0.0.1:5173')
    expect(developmentHtml).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/)
  })
})
