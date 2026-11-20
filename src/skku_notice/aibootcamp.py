"""URL policy for the public AI bootcamp notice board."""

import re
from urllib.parse import SplitResult, parse_qs

HOST = "aibootcamp-skku.co.kr"
ORIGIN = f"https://{HOST}"
ARTICLE = re.compile(r"/news/([0-9]+)")
PAGE = re.compile(r"page=[1-9][0-9]*")
IMAGE = re.compile(r"/data/(?:file/news|editor/[0-9]{4})/[a-zA-Z0-9_-]+\.(?i:png|jpe?g|gif|webp)")


def is_origin(url: SplitResult) -> bool:
    return url.scheme == "https" and url.netloc.lower() == HOST


def is_list(url: SplitResult) -> bool:
    return (is_origin(url) and url.path == "/news" and not url.fragment
            and (not url.query or bool(PAGE.fullmatch(url.query))))


def article_no(url: SplitResult, *, from_list: bool = False) -> str | None:
    match = ARTICLE.fullmatch(url.path)
    page_query = from_list and PAGE.fullmatch(url.query)
    if is_origin(url) and match and not url.fragment and (not url.query or page_query):
        return match[1]
    return None


def is_image(url: SplitResult) -> bool:
    return is_origin(url) and bool(IMAGE.fullmatch(url.path)) and not url.query and not url.fragment


def is_attachment(url: SplitResult, number: str) -> bool:
    if not is_origin(url) or url.path != "/bbs/download.php" or url.fragment:
        return False
    fields = parse_qs(url.query, keep_blank_values=True)
    return (set(fields) == {"bo_table", "wr_id", "no", "nonce"}
            and fields["bo_table"] == ["news"] and fields["wr_id"] == [number]
            and len(fields["no"]) == len(fields["nonce"]) == 1
            and bool(re.fullmatch(r"[0-9]+", fields["no"][0])))
