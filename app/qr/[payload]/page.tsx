import ShareQrClient from "./ShareQrClient";

type PageProps = {
  params: Promise<{
    payload: string;
  }>;
};

const ShareQrPage = async ({ params }: PageProps) => {
  const { payload } = await params;
  return <ShareQrClient payload={payload} />;
};

export default ShareQrPage;
