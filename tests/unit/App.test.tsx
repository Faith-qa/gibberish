import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/app/App'

describe('application shell', () => {
  it('renders the application landmarks and development status', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toHaveTextContent('Gibberish')
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your thoughts.')
    expect(screen.getByText('In development · M0')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('does not offer journal input or pretend journaling is implemented', () => {
    render(<App />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/You cannot enter or save journal content/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
  })
})
