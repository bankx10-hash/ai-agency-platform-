'use client'

import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { useEffect } from 'react'
import WorkflowBuilder from '../_components/WorkflowBuilder'

export default function EditWorkflowPage() {
  const { status } = useSession()
  const router = useRouter()
  const params = useParams()

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  return <WorkflowBuilder workflowId={params.id as string} />
}
