import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, UserX, Compass, MessageSquare } from 'lucide-react'
import { fetchPublicProfile, type PublicUserData } from '../lib/profile'
import { PublicProfileCard } from '../components/PublicProfileCard'
import { useAuth } from '../context/AuthContext'
import { useSafeBack } from '../lib/backToDetails'

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>()
  const back = useSafeBack('/home')
  const { user, username: authUsername } = useAuth()

  const [loading, setLoading] = useState(true)
  const [userData, setUserData] = useState<PublicUserData | null>(null)

  useEffect(() => {
    if (!username) {
      setLoading(false)
      return
    }

    let alive = true
    setLoading(true)

    fetchPublicProfile(username)
      .then((data) => {
        if (!alive) return
        setUserData(data)
        if (data) {
          document.title = `${data.profile.name || data.username} (@${data.username}) — AnimeStream`
        } else {
          document.title = `@${username} Not Found — AnimeStream`
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [username])

  const isSelf =
    user?.id && userData?.id
      ? user.id === userData.id
      : Boolean(authUsername && username && authUsername.toLowerCase() === username.toLowerCase())

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 overflow-x-hidden px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pt-10">
      {/* Top Back Navigation Bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
        >
          <ArrowLeft className="size-4" />
          <span>Back</span>
        </button>

        <div className="flex items-center gap-2 text-xs font-semibold text-muted">
          <span>Public Profile</span>
          {username && <span className="font-mono text-accent">@{username}</span>}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading ? (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
            <div className="skeleton h-48 w-full sm:h-64 md:h-72" />
            <div className="relative px-5 pb-6 sm:px-8 sm:pb-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
                  <div className="skeleton -mt-16 size-28 shrink-0 rounded-full ring-4 ring-card sm:-mt-20" />
                  <div className="space-y-2 flex-1 pb-2">
                    <div className="skeleton h-7 w-48 rounded-xl" />
                    <div className="skeleton h-4 w-32 rounded-lg" />
                  </div>
                </div>
                <div className="skeleton h-10 w-32 rounded-full" />
              </div>
              <div className="mt-6 skeleton h-20 w-full rounded-2xl" />
              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="skeleton h-20 rounded-2xl" />
                <div className="skeleton h-20 rounded-2xl" />
                <div className="skeleton h-20 rounded-2xl" />
              </div>
            </div>
          </div>
          <div className="skeleton h-12 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="aspect-[3/4] w-full rounded-2xl skeleton" />
            ))}
          </div>
        </div>
      ) : userData ? (
        /* Public Profile Card */
        <PublicProfileCard data={userData} isSelf={isSelf} />
      ) : (
        /* Not Found Fallback */
        <div className="rounded-3xl border border-border bg-card/60 p-8 text-center sm:p-12 shadow-xl">
          <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-card-2 text-muted">
            <UserX className="size-8" />
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold">Otaku Not Found</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            We couldn’t find an active user with the handle{' '}
            <span className="font-semibold text-foreground">@{username}</span>. They may not have signed in yet or might have changed their username.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/community"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95"
            >
              <MessageSquare className="size-4" />
              <span>Community Lounge</span>
            </Link>
            <Link
              to="/home"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
            >
              <Compass className="size-4" />
              <span>Explore AnimeStream</span>
            </Link>
          </div>
        </div>
      )}
    </main>
  )
}
