import { ISong } from '@/types/responses/song'
import { HomeHeader } from './header'

function mockRandomSongs(songs: ISong[]) {
  cy.intercept('/rest/getRandomSongs**', {
    body: {
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        randomSongs: { song: songs },
      },
    },
  }).as('getRandomSongs')
}

describe('HomeHeader Component', () => {
  it('should not show component if songs list is empty', () => {
    mockRandomSongs([])

    cy.mount(<HomeHeader />)
    cy.wait('@getRandomSongs')

    // Wait for the loading skeleton to go away, not just for the carousel to be absent.
    cy.get('[data-cy-root]').should('be.empty')
    cy.getByTestId('header-carousel').should('not.exist')
  })

  it('mounts the component and shows the songs correctly', () => {
    cy.mockCoverArt()

    cy.fixture('songs/random').then((songs: ISong[]) => {
      mockRandomSongs(songs)

      cy.mount(<HomeHeader />)
      cy.wait('@getRandomSongs')

      songs.forEach((song, index) => {
        cy.getByTestId(`carousel-header-song-${index}`).as('activeCarousel')

        cy.get('@activeCarousel')
          .findByTestId('header-bg')
          .should('have.css', 'background-image')

        cy.get('@activeCarousel')
          .findByTestId('header-title')
          .should('have.text', song.title)

        cy.get('@activeCarousel')
          .findByTestId('header-artist')
          .should('have.text', song.artist)

        cy.get('@activeCarousel')
          .findByTestId('header-genre')
          .should('have.text', song.genre)

        cy.get('@activeCarousel')
          .findByTestId('header-year')
          .should('have.text', song.year)
      })

      cy.getByTestId('header-carousel-previous')
        .should('be.visible')
        .and('be.enabled')

      cy.getByTestId('header-carousel-next')
        .should('be.visible')
        .and('be.enabled')
    })
  })
})
