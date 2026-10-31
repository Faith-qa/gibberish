import { Component } from 'react'
import type { ReactNode } from 'react'
import type { AppController } from './controller'
import { AppFrame } from './App'

/** Discard the private subtree and capability without retaining/logging errors. */
export class PrivacyBoundary extends Component<{ controller: AppController; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.controller.lock('The interface stopped. Authorization was revoked.') }
  render() {
    if (!this.state.failed) return this.props.children
    return <AppFrame><main id="main" tabIndex={-1} className="mx-auto max-w-4xl space-y-6 px-5 py-12"><h1 className="text-3xl">The journal interface stopped</h1><p role="alert">This tab was locked and private content was cleared. Encrypted records have been preserved.</p><button className="button" onClick={() => location.reload()}>Reload local journal</button></main></AppFrame>
  }
}
