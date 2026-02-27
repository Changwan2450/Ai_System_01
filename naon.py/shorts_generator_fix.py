# get_target_by_bno() 함수만 수정
def get_target_by_bno(bno: int) -> Optional[Dict[str, Any]]:
    """shorts_queue에서 대상 조회 (ai_board JOIN)"""
    try:
        query = text("""
            SELECT 
                q.bno, b.title, b.content, q.video_type, 
                COALESCE(b.p_id, 'default') as p_id, q.status
            FROM shorts_queue q
            JOIN ai_board b ON q.bno = b.bno
            WHERE q.bno = :bno
            LIMIT 1
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"bno": bno})
            row = result.fetchone()
            
            if not row:
                return None
            
            return {
                "bno": row[0],
                "title": row[1],
                "content": row[2],
                "video_type": row[3],
                "p_id": row[4],
                "status": row[5]
            }
    except Exception as e:
        logger.error(f"DB 조회 실패 (bno={bno}): {e}")
        return None
