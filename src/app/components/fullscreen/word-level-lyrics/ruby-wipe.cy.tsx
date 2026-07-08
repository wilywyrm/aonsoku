import type { CSSProperties } from 'react'

/**
 * `--fill` is a project custom property, absent from React's CSSProperties type,
 * so it needs a cast. The RAF loop writes it in px for ruby units (task 15).
 */
function fillVar(px: number): CSSProperties {
  return { '--fill': `${px}px` } as CSSProperties
}

const RubyUnit = () => (
  <ruby>
    漢<rt>かん</rt>
  </ruby>
)

describe('Ruby two-layer wipe + typography', () => {
  it('fill layer masks primary over currentColor at --fill px (bicolor split ~20px)', () => {
    cy.mount(
      <div
        className="dark"
        style={{
          background: '#101010',
          color: '#ffffff',
          fontSize: '48px',
          padding: '32px',
          width: 'fit-content',
        }}
      >
        <span
          data-testid="ruby-unit"
          className="ruby-unit-wrapper"
          style={{ width: '40px', ...fillVar(20) }}
        >
          <span className="ruby-unit-base">
            <RubyUnit />
          </span>
          <span className="ruby-unit-fill" aria-hidden="true">
            <RubyUnit />
          </span>
        </span>
      </div>,
    )

    // MUST remain inline-block (task 5.MUST NOT) + relative for the abs fill child.
    cy.getByTestId('ruby-unit')
      .should('have.css', 'display', 'inline-block')
      .and('have.css', 'position', 'relative')

    cy.get('.ruby-unit-base').then(($base) => {
      const baseColor = getComputedStyle($base[0]).color
      cy.get('.ruby-unit-fill').then(($fill) => {
        const cs = getComputedStyle($fill[0])
        // Sung (primary) vs unsung (currentColor) must differ → a split can show.
        expect(cs.color, 'fill paints hsl(var(--primary))').to.not.equal(
          baseColor,
        )
        expect(cs.position, 'fill is absolutely stacked').to.equal('absolute')
        // Without this, the overlay eats clicks and breaks onWordClick.
        expect(cs.pointerEvents, 'clicks fall through to base').to.equal('none')

        const mask = cs.maskImage || cs.webkitMaskImage
        cy.log(`mask-image: ${mask}`)
        expect(mask, 'mask is a linear-gradient').to.contain('gradient')
        // 20px ± 3px feather resolves to 17px / 23px — PIXELS, not %, so the
        // feather never collapses on a tiny single-kanji unit.
        expect(mask, 'feather lower bound in px').to.contain('17px')
        expect(mask, 'feather upper bound in px').to.contain('23px')
      })
    })

    cy.getByTestId('ruby-unit').screenshot('ruby-wipe-20px')
  })

  it('at --fill:0px nothing is filled; at full width it is fully filled', () => {
    cy.mount(
      <div className="dark" style={{ color: '#fff', fontSize: '48px' }}>
        <span
          data-testid="unit-empty"
          className="ruby-unit-wrapper"
          style={{ width: '40px', ...fillVar(0) }}
        >
          <span className="ruby-unit-fill" aria-hidden="true">
            <RubyUnit />
          </span>
        </span>
        <span
          data-testid="unit-full"
          className="ruby-unit-wrapper"
          style={{ width: '40px', ...fillVar(40) }}
        >
          <span className="ruby-unit-fill" aria-hidden="true">
            <RubyUnit />
          </span>
        </span>
      </div>,
    )

    cy.getByTestId('unit-empty')
      .find('.ruby-unit-fill')
      .then(($el) => {
        const mask = getComputedStyle($el[0]).maskImage
        // fill=0 → opaque band ends at -3px (before the box) → nothing revealed.
        expect(mask).to.contain('-3px')
      })
    cy.getByTestId('unit-full')
      .find('.ruby-unit-fill')
      .then(($el) => {
        const mask = getComputedStyle($el[0]).maskImage
        // fill=40 (full width) → opaque to 37px, feather to 43px (past the box).
        expect(mask).to.contain('37px')
      })
  })

  it('rt renders at ~0.5em; ruby positioned over', () => {
    cy.mount(
      <div className="dark" style={{ fontSize: '32px', color: '#fff' }}>
        <ruby data-testid="ruby-el">
          漢<rt data-testid="rt-el">かん</rt>
        </ruby>
      </div>,
    )
    cy.getByTestId('ruby-el').then(($ruby) => {
      const pos = getComputedStyle($ruby[0]).getPropertyValue('ruby-position')
      cy.log(`ruby-position: ${pos}`)
      expect(pos.trim()).to.match(/over|alternate/)
    })
    cy.getByTestId('rt-el').then(($rt) => {
      // 0.5em of 32px = 16px.
      expect(parseFloat(getComputedStyle($rt[0]).fontSize)).to.be.closeTo(16, 1)
    })
  })

  it('plain <p> and ruby <p> have equal offsetHeight (rt line-height reserved)', () => {
    cy.mount(
      <div
        data-testid="word-sync-lyrics-box"
        style={{ fontSize: '32px', color: '#fff', width: '400px' }}
      >
        <p data-testid="p-plain">かんじ</p>
        <p data-testid="p-ruby">
          <ruby>
            漢<rt>かん</rt>
          </ruby>
          じ
        </p>
        <p data-testid="p-natural" style={{ lineHeight: 'normal' }}>
          <ruby>
            漢<rt>かん</rt>
          </ruby>
          じ
        </p>
      </div>,
    )
    cy.getByTestId('p-plain').then(($plain) => {
      const plainH = $plain[0].offsetHeight
      cy.getByTestId('p-natural').then(($nat) => {
        // The reserved line-height must actually cover the intrinsic ruby stack,
        // otherwise equality below would only hold by coincidence.
        expect(
          plainH,
          'reservation >= natural ruby height',
        ).to.be.at.least($nat[0].offsetHeight)
      })
      cy.getByTestId('p-ruby').then(($ruby) => {
        expect(
          $ruby[0].offsetHeight,
          'ruby p height == plain p height (no reflow)',
        ).to.equal(plainH)
      })
    })
  })
})
