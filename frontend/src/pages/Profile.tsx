import React from 'react'

// Profile page removed in public/anonymous deployment.
// All account management and profile editing features have been disabled
// to remove authentication and user management from the public build.

export default function Profile(): JSX.Element {
  return (
    <main style={{ padding: 32 }}>
      <h2>Profile unavailable</h2>
      <p>
        User profiles and account management have been removed in this public
        deployment. There is no user authentication or account-related
        functionality available.
      </p>
    </main>
  )
}
